package com.replayradio.app

import okhttp3.Call
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.InputStream

/**
 * 直播取流链路里的「字节层」：上游 FLV 连接的持有者 + FLV 时间戳归一化。
 *
 * 为什么单独放一个文件：
 *  · 上游直播连接要一直持有到客户端断开，不能像普通 JSON 请求那样拿到就关，
 *    所以用一个带 close() 的小对象把 call/response/stream 绑在一起，保证 finally 里不会漏；
 *  · FLV 时间戳改写是纯字节处理，跟 HTTP 路由、B 站接口无关，混进 LocalServer 会把
 *    「哪一段在处理连接、哪一段在处理标签」缠在一起。
 */

/**
 * 一路已经建立的上游直播 FLV 连接。close() 同时关流、关响应并取消 call：
 * 只关闭 inputStream 的话，读线程可能还卡在 socket read 上，连接会拖到超时才释放。
 */
class LiveFlvStream(
    private val call: Call,
    private val resp: Response,
    val input: InputStream,
    val room: String
) {
    fun close() {
        try { input.close() } catch (_: Exception) {}
        try { resp.close() } catch (_: Exception) {}
        try { call.cancel() } catch (_: Exception) {}
    }
}

/**
 * 把 FLV 媒体 tag 的时间戳改成「从 0 开始、跨断点连续」。
 *
 * 为什么需要它（对应 Python 版 _FlvTimeline 的同一段背景）：
 *  · 部分房间的媒体 tag 直接带绝对 PTS（HLS→ffmpeg 兜底时首帧 6,308,366 ms；
 *    直连 FLV 也抓到过尾随 7,125,199 ms 的跳变）。mpegts.js 以第一个时间戳为基准，
 *    遇到这种前跳会判成时间轴断裂：轻则数据被塞进播不到的区间（currentTime 不再前进，
 *    看门狗报「画面已停止」），重则直接抛错（「连接中断」）。
 *  · 这里只改 tag 头的 4 字节时间戳，负载原样转发；音视频各自的基准只在
 *    「首个媒体帧」和「断点」时调整，正常流的 A/V 相对关系不变。
 *
 * 实现上按 tag 整帧处理：不完整的 tag 留在内部缓冲区等下一块数据。
 * 非 FLV 数据（开头就不是 "FLV"）进入 passthrough，原样放过，绝不把流弄坏。
 */
class FlvTimeline(private val label: String) {
    companion object {
        private const val MAX_STEP = 5000L      // 同一轨相邻 tag 正常不会超过 5 秒
        private const val FIX_STEP = 40L        // 断点后补的一小步，让时间轴继续前进
        private const val SKIP_LIMIT = 8        // 连续这么多个跳变 tag 仍然对不上，才认定整条流重启
        private const val MAX_TAG = 8 * 1024 * 1024
        private const val MAX_HEADER = 8 * 1024 * 1024
    }

    private var buf = ByteArray(64 * 1024)
    private var len = 0
    private var headerDone = false
    private var passthrough = false
    private var base: Long? = null
    private val offset = HashMap<Int, Long>()     // tag 类型 -> (raw - out)
    private val lastRaw = HashMap<Int, Long>()
    private val lastOut = HashMap<Int, Long>()
    private val bogus = HashMap<Int, Int>()        // 各轨连续跳变 tag 数
    private var warned = false

    /** 喂一块上游字节，返回可以转发的字节（可能为空：还在等一个完整 tag）。 */
    fun feed(chunk: ByteArray, off: Int, n: Int): ByteArray {
        if (n <= 0) return ByteArray(0)
        if (passthrough) return chunk.copyOfRange(off, off + n)
        append(chunk, off, n)
        val out = ByteArrayOutputStream(len + 16)
        var pos = 0
        while (true) {
            if (!headerDone) {
                if (len - pos < 9) break
                if (buf[pos] != 0x46.toByte() || buf[pos + 1] != 0x4C.toByte() ||
                    buf[pos + 2] != 0x56.toByte()) {
                    passthrough = true
                    out.write(buf, pos, len - pos)
                    pos = len
                    break
                }
                val dataOffset = readU32(pos + 5)
                if (dataOffset < 9 || dataOffset > MAX_HEADER) {
                    // 头里的偏移量不合理：整段原样放过，别在这里赌格式
                    passthrough = true
                    out.write(buf, pos, len - pos)
                    pos = len
                    break
                }
                val need = dataOffset + 4          // + PreviousTagSize0
                if (len - pos < need) break
                out.write(buf, pos, need.toInt())
                pos += need.toInt()
                headerDone = true
                continue
            }
            if (len - pos < 11) break
            val size = ((buf[pos + 1].toInt() and 0xFF) shl 16) or
                    ((buf[pos + 2].toInt() and 0xFF) shl 8) or (buf[pos + 3].toInt() and 0xFF)
            val total = 11 + size + 4
            if (total > MAX_TAG) {
                // 明显不是正常 tag：放弃改写，剩下的原样转发
                passthrough = true
                out.write(buf, pos, len - pos)
                pos = len
                break
            }
            if (len - pos < total) break
            val typ = buf[pos].toInt() and 0x1F     // 8=audio 9=video 18=script
            if ((typ == 8 || typ == 9) && !fix(typ, pos)) {
                // 这一帧时间戳明显是坏的：整帧丢掉，别让它把本轨基准拽走
                pos += total
                continue
            }
            out.write(buf, pos, total)
            pos += total
        }
        if (pos > 0) {
            val remain = len - pos
            if (remain > 0) System.arraycopy(buf, pos, buf, 0, remain)
            len = remain
        }
        return out.toByteArray()
    }

    private fun append(chunk: ByteArray, off: Int, n: Int) {
        if (len + n > buf.size) {
            var cap = buf.size
            while (cap < len + n) cap = cap shl 1
            buf = buf.copyOf(cap)
        }
        System.arraycopy(chunk, off, buf, len, n)
        len += n
    }

    private fun readU32(p: Int): Long =
        ((buf[p].toLong() and 0xFF) shl 24) or ((buf[p + 1].toLong() and 0xFF) shl 16) or
                ((buf[p + 2].toLong() and 0xFF) shl 8) or (buf[p + 3].toLong() and 0xFF)

    /**
     * 改写 buf[start .. start+total) 这个 tag 的时间戳。
     *
     * ⚠️ 配置帧（AVC/AAC sequence header）没有播放时间，不能参与基准计算：
     *    它们的 ts 往往是 0，如果照「普通帧」更新 lastRaw，下一帧就会被误判成
     *    几百万毫秒的跳变，整条音轨的时间轴跟着错位。所以配置帧只沿用上一次输出，
     *    提前 return，不碰 base/offset/lastRaw/lastOut。
     *
     * 返回 false 表示这一帧的时间戳是坏的，调用方应当整帧丢弃。
     */
    private fun fix(typ: Int, start: Int): Boolean {
        val ts = ((buf[start + 4].toInt() and 0xFF).toLong() shl 16) or
                ((buf[start + 5].toInt() and 0xFF).toLong() shl 8) or
                (buf[start + 6].toInt() and 0xFF).toLong() or
                ((buf[start + 7].toInt() and 0xFF).toLong() shl 24)
        val payloadSize = ((buf[start + 1].toInt() and 0xFF) shl 16) or
                ((buf[start + 2].toInt() and 0xFF) shl 8) or (buf[start + 3].toInt() and 0xFF)

        var config = false
        if (typ == 9 && payloadSize >= 2) {
            // VideoTagHeader: byte0=FrameType<<4|CodecID, byte1=AVCPacketType(0=sequence header)
            val codec = buf[start + 11].toInt() and 0x0F
            config = (codec == 7 || codec == 12) && (buf[start + 12].toInt() and 0xFF) == 0
        } else if (typ == 8 && payloadSize >= 2) {
            // AudioTagHeader: byte0=SoundFormat<<4|..., byte1=AACPacketType(0=sequence header)
            val fmt = (buf[start + 11].toInt() and 0xF0) shr 4
            config = fmt == 10 && (buf[start + 12].toInt() and 0xFF) == 0
        }
        if (config) {
            writeTs(start, lastOut[typ] ?: 0L)
            return true
        }

        val out: Long
        if (base == null) {
            base = ts
            offset[typ] = ts
            out = 0L
        } else if (!offset.containsKey(typ)) {
            // 另一条轨的第一个媒体帧：保留它和基准的真实距离。
            // 以前这里差得远就把 out 归零，于是晚起的音频整段提前，音画永久错位。
            val d = ts - base!!
            if (d >= 0) { offset[typ] = base!!; out = d } else { offset[typ] = ts; out = 0L }
            if (Math.abs(d) > MAX_STEP) warn(typ, ts, out, "两轨基准相差 $d ms")
        } else {
            val delta = ts - (lastRaw[typ] ?: ts)
            if (Math.abs(delta) > MAX_STEP) {
                val n = (bogus[typ] ?: 0) + 1
                bogus[typ] = n
                if (n <= SKIP_LIMIT) {
                    // 单帧跳变：丢掉这一帧，绝不能重设本轨基准 ——
                    // 一旦重设，这条轨和另一条轨的时间轴就永久差了这段跳变。
                    warn(typ, ts, lastOut[typ] ?: 0L, "单轨跳变 $delta ms，丢弃该帧")
                    return false
                }
                out = (lastOut[typ] ?: 0L) + FIX_STEP
                offset[typ] = ts - out
                warn(typ, ts, out, "连续 $n 帧跳变 $delta ms，重新对齐时间轴")
            } else {
                bogus[typ] = 0
                val v = ts - (offset[typ] ?: 0L)
                out = if (v < 0) (lastOut[typ] ?: 0L) + 1 else v
            }
        }
        lastRaw[typ] = ts
        lastOut[typ] = out
        writeTs(start, out)
        return true
    }

    /** FLV 时间戳 = 低 24 位大端 + 最高 8 位单独一个字节，别写成小端。 */
    private fun writeTs(start: Int, v0: Long) {
        val v = v0 and 0xFFFFFFFFL
        buf[start + 4] = ((v shr 16) and 0xFF).toByte()
        buf[start + 5] = ((v shr 8) and 0xFF).toByte()
        buf[start + 6] = (v and 0xFF).toByte()
        buf[start + 7] = ((v shr 24) and 0xFF).toByte()
    }

    private fun warn(typ: Int, ts: Long, out: Long, why: String) {
        if (warned) return
        warned = true
        Diag.log("[play] $label 时间戳已归一化：type=$typ raw=$ts → $out（$why）")
    }
}
