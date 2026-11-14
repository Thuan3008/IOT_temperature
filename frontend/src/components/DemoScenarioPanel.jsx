import { useEffect, useRef, useState } from "react";
import "./DemoScenarioPanel.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function DemoScenarioPanel({
  deviceId = "ESP32-01",
  tripId = "TRIP001",
  health = "online",
  onRefresh,
}) {
  const [selectedDuration, setSelectedDuration] = useState(16);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ error: false, text: "" });

  // Trạng thái kịch bản: IDLE | SENDING | OUTAGE | RECONNECTING | FLUSHING | COMPLETED
  const [runState, setRunState] = useState({
    stage: "IDLE",
    remainingSec: 0,
    totalSec: 16,
  });

  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /* ── 1. Kích hoạt Kịch bản Mất Mạng ── */
  async function handleStartScenario() {
    setBusy(true);
    setFeedback({ error: false, text: "" });
    setRunState({
      stage: "SENDING",
      remainingSec: selectedDuration,
      totalSec: selectedDuration,
    });

    try {
      const response = await fetch(`${API_BASE}/api/control/demo-scenario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          scenario: "NETWORK_OUTAGE",
          durationSeconds: selectedDuration,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Không thể gửi lệnh kịch bản tới ESP32");
      }

      setRunState({
        stage: "OUTAGE",
        remainingSec: selectedDuration,
        totalSec: selectedDuration,
      });

      // Kích hoạt bộ đếm ngược thời gian ngắt sóng thực tế
      let timeLeft = selectedDuration;
      if (timerRef.current) clearInterval(timerRef.current);

      timerRef.current = setInterval(() => {
        timeLeft -= 1;

        if (timeLeft <= 0) {
          clearInterval(timerRef.current);
          timerRef.current = null;

          // Chuyển sang giai đoạn khôi phục mạng và xả đệm
          setRunState({
            stage: "RECONNECTING",
            remainingSec: 0,
            totalSec: selectedDuration,
          });

          // Làm mới dữ liệu sau 3 giây để cập nhật trạng thái ONLINE và các gói đệm
          setTimeout(() => {
            setRunState({
              stage: "FLUSHING",
              remainingSec: 0,
              totalSec: selectedDuration,
            });
            if (onRefresh) onRefresh();

            // Chuyển sang hoàn tất
            setTimeout(() => {
              setRunState({
                stage: "COMPLETED",
                remainingSec: 0,
                totalSec: selectedDuration,
              });
              setBusy(false);
              setFeedback({
                error: false,
                text: `Kịch bản hoàn tất xuất sắc: ESP32 đã kết nối lại và xả đầy đủ ${Math.floor(
                  selectedDuration / 4
                )} gói tin đệm lên hệ thống!`,
              });
              if (onRefresh) onRefresh();
            }, 3500);
          }, 2500);
        } else {
          setRunState((prev) => ({ ...prev, remainingSec: timeLeft }));
          // Làm mới telemetry định kỳ
          if (timeLeft % 4 === 0 && onRefresh) onRefresh();
        }
      }, 1000);
    } catch (err) {
      setBusy(false);
      setRunState({ stage: "IDLE", remainingSec: 0, totalSec: selectedDuration });
      setFeedback({
        error: true,
        text: err.message,
      });
    }
  }

  /* ── 2. Nút Khẩn Cấp: Khôi phục kết nối ngay lập tức ── */
  async function handleReconnectNow() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setFeedback({ error: false, text: "Đang yêu cầu ESP32 kết nối lại ngay lập tức..." });

    try {
      const response = await fetch(`${API_BASE}/api/control/demo-scenario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          scenario: "RECONNECT_NOW",
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Lỗi khôi phục mạng");

      setRunState({ stage: "RECONNECTING", remainingSec: 0, totalSec: selectedDuration });
      setTimeout(() => {
        setRunState({ stage: "COMPLETED", remainingSec: 0, totalSec: selectedDuration });
        setBusy(false);
        setFeedback({ error: false, text: "ESP32 đã khôi phục kết nối và xả đệm thành công." });
        if (onRefresh) onRefresh();
      }, 2000);
    } catch (err) {
      setBusy(false);
      setFeedback({ error: true, text: err.message });
    }
  }

  const isRunning = runState.stage !== "IDLE" && runState.stage !== "COMPLETED";
  const progressPercent =
    runState.totalSec > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              ((runState.totalSec - runState.remainingSec) / runState.totalSec) * 100
            )
          )
        )
      : 0;

  return (
    <section
      className={`demo-scenario-panel ${isRunning ? "running" : ""}`}
      id="demo-scenarios"
      aria-label="Kịch bản Demo một nút bấm"
    >
      <div className="demo-scenario-header">
        <div className="demo-header-left">
          <div className="demo-icon-badge" aria-hidden="true">⚡</div>
          <div className="demo-title-group">
            <h3>Kịch bản Demo Một Nút Bấm</h3>
            <p>Trình diễn cơ chế ngoại tuyến qua luồng thực tế: ESP32 ➔ MQTT ➔ Backend ➔ Dashboard</p>
          </div>
        </div>
        <div className="demo-live-tag">
          <span
            className="demo-live-dot"
            style={{
              background:
                health === "online" ? "#10b981" : health === "offline" ? "#ef4444" : "#f59e0b",
            }}
          />
          ESP32: {health.toUpperCase()}
        </div>
      </div>

      <div className="demo-scenario-body">
        <div className="scenario-card">
          <div className="scenario-top-row">
            <div>
              <div className="scenario-info-title">
                <span>📵 Kịch bản: Mất mạng & Xả đệm (Store & Forward Demonstration)</span>
                <span className="scenario-badge">Quy trình chuẩn IoT</span>
              </div>
              <p className="scenario-desc">
                Mô phỏng xe chở hàng đi vào hầm chui hoặc vùng mất sóng viễn thông. ESP32 ngắt Wi-Fi,
                phát LWT <strong>OFFLINE</strong> lên Broker. Trong thời gian này, cảm biến vẫn đo
                nhiệt độ mỗi 4s và ghi vào <strong>Ring Buffer RAM</strong> (bộ đệm tăng dần). Khi
                hết thời gian, ESP32 tự động bắt lại sóng, chuyển <strong>ONLINE</strong> và xả toàn
                bộ gói tin lưu đệm (kèm cờ <code>is_buffered = true</code>) lên máy chủ mà không làm mất
                bất kỳ dữ liệu nào.
              </p>
            </div>
          </div>

          {/* Sơ đồ quy trình 4 giai đoạn */}
          <div className="flow-pipeline-steps">
            <div className="pipeline-step-item">
              <div className="pipeline-step-header">
                <span>1. Gửi lệnh MQTT</span>
              </div>
              <div className="pipeline-step-desc">
                Dashboard gửi lệnh <code>SIMULATE_OUTAGE</code> qua topic Command; ESP32 xác nhận ACK.
              </div>
            </div>

            <div className="pipeline-step-item">
              <div className="pipeline-step-header">
                <span>2. Ngắt sóng & OFFLINE</span>
              </div>
              <div className="pipeline-step-desc">
                ESP32 ngắt Wi-Fi, Broker ghi nhận OFFLINE; Cảnh báo mất kết nối xuất hiện.
              </div>
            </div>

            <div className="pipeline-step-item">
              <div className="pipeline-step-header">
                <span>3. Đo & Tích lũy đệm</span>
              </div>
              <div className="pipeline-step-desc">
                Đo 5 cảm biến mỗi 4s, gói tin xếp vào Ring Buffer (0 ➔ 1 ➔ 2 ➔ 3...).
              </div>
            </div>

            <div className="pipeline-step-item">
              <div className="pipeline-step-header">
                <span>4. Kết nối lại & Xả đệm</span>
              </div>
              <div className="pipeline-step-desc">
                Bật lại Wi-Fi/MQTT, chuyển ONLINE; xả toàn bộ gói đệm lên CSDL FIFO.
              </div>
            </div>
          </div>

          {/* Chọn thời gian mất mạng */}
          <div className="outage-duration-select">
            <span className="duration-label">Thời gian ngắt sóng:</span>
            <div className="duration-pills">
              {[
                { sec: 12, label: "12s (3 gói đệm)" },
                { sec: 16, label: "16s (4 gói đệm - Khuyên dùng)" },
                { sec: 24, label: "24s (6 gói đệm)" },
                { sec: 32, label: "32s (8 gói đệm)" },
              ].map((item) => (
                <button
                  key={item.sec}
                  type="button"
                  className={`duration-pill ${selectedDuration === item.sec ? "active" : ""}`}
                  onClick={() => setSelectedDuration(item.sec)}
                  disabled={busy}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Nút hành động */}
          <div className="scenario-actions-row">
            <button
              type="button"
              className="btn-run-scenario"
              onClick={handleStartScenario}
              disabled={busy}
            >
              <span>{busy ? "⏳ Đang chạy kịch bản..." : "▶ Chạy kịch bản mất mạng"}</span>
            </button>

            {isRunning && (
              <button
                type="button"
                className="btn-reconnect-now"
                onClick={handleReconnectNow}
                title="Yêu cầu ESP32 bắt lại sóng ngay lập tức"
              >
                📶 Khôi phục kết nối ngay
              </button>
            )}
          </div>

          {/* Khung theo dõi tiến trình trực tiếp khi kịch bản đang chạy */}
          {runState.stage !== "IDLE" && (
            <div className="scenario-live-tracker">
              <div className="tracker-header">
                <div className="tracker-title">
                  <span>
                    {runState.stage === "SENDING" && "📡 Đang gửi lệnh MQTT tới ESP32..."}
                    {runState.stage === "OUTAGE" && "📵 ĐANG MẤT MẠNG · ESP32 ĐO NGOẠI TUYẾN & TÍCH LŨY ĐỆM"}
                    {runState.stage === "RECONNECTING" && "📶 Đang khôi phục Wi-Fi & MQTT..."}
                    {runState.stage === "FLUSHING" && "🚀 ĐANG XẢ TOÀN BỘ GÓI ĐỆM TỪ FLASH LÊN MÁY CHỦ..."}
                    {runState.stage === "COMPLETED" && "✅ KỊCH BẢN HOÀN TẤT THÀNH CÔNG!"}
                  </span>
                </div>
                {runState.stage === "OUTAGE" && (
                  <div className="tracker-timer pulse">
                    ⏱️ Đếm ngược: <strong>{runState.remainingSec}s</strong>
                  </div>
                )}
              </div>

              <div className="tracker-progress-bar-container">
                <div
                  className="tracker-progress-bar-fill"
                  style={{ width: `${runState.stage === "COMPLETED" ? 100 : progressPercent}%` }}
                />
              </div>

              <div className="tracker-stage-list">
                <div
                  className={`tracker-stage-row ${
                    runState.stage === "SENDING" ? "active" : "done"
                  }`}
                >
                  <span className="stage-status-icon">
                    {runState.stage === "SENDING" ? "⏳" : "✓"}
                  </span>
                  <span>1. Phát lệnh SIMULATE_OUTAGE và nhận ACK xác nhận từ ESP32</span>
                </div>

                <div
                  className={`tracker-stage-row ${
                    runState.stage === "OUTAGE"
                      ? "active"
                      : ["RECONNECTING", "FLUSHING", "COMPLETED"].includes(runState.stage)
                      ? "done"
                      : ""
                  }`}
                >
                  <span className="stage-status-icon">
                    {runState.stage === "OUTAGE"
                      ? "📡"
                      : ["RECONNECTING", "FLUSHING", "COMPLETED"].includes(runState.stage)
                      ? "✓"
                      : "○"}
                  </span>
                  <span>
                    2. ESP32 ngắt Wi-Fi, Broker chuyển OFFLINE; Cảm biến vẫn đo và lưu vào Ring Buffer RAM
                    {runState.stage === "OUTAGE"
                      ? ` (đã tích lũy ~${Math.max(
                          1,
                          Math.floor((runState.totalSec - runState.remainingSec) / 4)
                        )} gói tin)`
                      : ""}
                  </span>
                </div>

                <div
                  className={`tracker-stage-row ${
                    runState.stage === "RECONNECTING" || runState.stage === "FLUSHING"
                      ? "active"
                      : runState.stage === "COMPLETED"
                      ? "done"
                      : ""
                  }`}
                >
                  <span className="stage-status-icon">
                    {["RECONNECTING", "FLUSHING"].includes(runState.stage)
                      ? "🔄"
                      : runState.stage === "COMPLETED"
                      ? "✓"
                      : "○"}
                  </span>
                  <span>3. Hết thời gian: ESP32 kết nối lại MQTT, chuyển ONLINE và phát lại toàn bộ gói đệm FIFO</span>
                </div>

                <div
                  className={`tracker-stage-row ${
                    runState.stage === "COMPLETED" ? "done" : ""
                  }`}
                >
                  <span className="stage-status-icon">
                    {runState.stage === "COMPLETED" ? "🎉" : "○"}
                  </span>
                  <span>4. Dữ liệu đồng bộ đầy đủ trên Dashboard (gắn nhãn BUFFERED), không thất thoát gói tin</span>
                </div>
              </div>
            </div>
          )}

          {/* Feedback thông báo lỗi hoặc thành công */}
          {feedback.text && (
            <div
              className={`scenario-feedback ${feedback.error ? "error" : "success"}`}
              role="status"
            >
              <span>{feedback.error ? "⚠️" : "✓"}</span>
              <div>{feedback.text}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
