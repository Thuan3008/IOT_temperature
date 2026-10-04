import { useEffect, useRef, useState } from "react";
import "./ControlPanel.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function ControlPanel({ deviceId, tripId, deliveryMode, setDeliveryMode, limits, onStarted }) {
  const dialog = useRef(null);
  const [options, setOptions] = useState({ lots: [], profiles: [] });
  const [form, setForm] = useState({ tripId, lotId: "LOT-VEG-001", profileId: "VEGETABLE_CHILLED", min: limits.min ?? "", max: limits.max ?? "" });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ error: false, text: "" });
  const profile = options.profiles.find((item) => item.profile_id === form.profileId);

  // Ngưỡng của profile chỉ điền khi mở modal/chọn profile, tránh polling ghi đè input.
  function selectProfile(profileId, extra = {}) {
    const selected = options.profiles.find((item) => item.profile_id === profileId);
    setForm((previous) => ({ ...previous, ...extra, profileId,
      min: selected?.min_temperature ?? "", max: selected?.max_temperature ?? "" }));
  }

  async function openTrip() {
    dialog.current.showModal();
    setLoading(true);
    setOptions({ lots: [], profiles: [] });
    setFeedback({ error: false, text: "" });
    try {
      const response = await fetch(`${API_BASE}/api/control/options`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Không tải được lô hàng và profile");
      setOptions(data);
      const lot = data.lots.find((item) => item.lot_id === "LOT-VEG-001") || data.lots[0];
      const selected = data.profiles.find((item) => item.profile_id === lot?.profile_id) || data.profiles[0];
      setForm({ tripId, lotId: lot?.lot_id || "", profileId: selected?.profile_id || "",
        min: selected?.min_temperature ?? "", max: selected?.max_temperature ?? "" });
    } catch (error) { setFeedback({ error: true, text: error.message }); }
    finally { setLoading(false); }
  }

  useEffect(() => () => { dialog.current?.close(); }, []);

  async function send(path, body) {
    setBusy(true);
    setFeedback({ error: false, text: "" });
    try {
      const response = await fetch(`${API_BASE}/api/control/${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Thao tác không thành công");
      if (!result.acknowledged) throw new Error("Chưa nhận được ACK từ ESP32; trạng thái chưa xác định.");
      setFeedback({ error: false, text: result.message || "ESP32 đã xác nhận áp dụng lệnh." });
      return result;
    } catch (error) { setFeedback({ error: true, text: error.message }); return null; }
    finally { setBusy(false); }
  }

  async function toggleDelivery() {
    const result = await send("delivery-mode", { deviceId, tripId, deliveryMode: !deliveryMode });
    if (result) setDeliveryMode(result.deliveryMode);
  }

  async function startTrip(event) {
    event.preventDefault();
    if (form.min === "" || form.max === "" || Number(form.min) >= Number(form.max)) {
      setFeedback({ error: true, text: "Nhập đủ Tmin/Tmax và bảo đảm Tmin nhỏ hơn Tmax." });
      return;
    }
    const result = await send("start-trip", { deviceId, tripId: form.tripId, lotId: form.lotId,
      profileId: form.profileId, minTemperature: Number(form.min), maxTemperature: Number(form.max), deliveryMode: false });
    if (result) {
      setDeliveryMode(result.deliveryMode);
      onStarted(result);
      dialog.current.close();
    }
  }

  const notice = feedback.text && <div className={`control-feedback ${feedback.error ? "error" : "success"}`} role="status">{feedback.text}</div>;

  return <section className="panel control-panel" id="controls" aria-label="Điều khiển nghiệp vụ">
    <div className="panel-header"><div className="panel-title-group"><div className="panel-eyebrow">Điều khiển nghiệp vụ · Demo</div><div className="panel-title">Control Panel</div></div><span className={`delivery-badge ${deliveryMode ? "on" : "off"}`}>DELIVERY {deliveryMode ? "ON" : "OFF"}</span></div>
    <div className="delivery-mode-section">
      <div className="delivery-info"><div className="delivery-title">{deliveryMode ? "Đang giao hàng" : "Đang vận chuyển"}</div><div className="delivery-sub">{deliveryMode ? "Mở cửa giao hàng hợp lệ. Cảnh báo nhiệt độ và mở cửa quá lâu vẫn hoạt động." : "Trong chuyến đang chạy, mở cửa sẽ kích hoạt cảnh báo vi phạm."}</div></div>
      <button className={`btn ${deliveryMode ? "btn-secondary" : "btn-primary"}`} type="button" onClick={toggleDelivery} disabled={busy}>{busy ? "Đang chờ ESP32 xác nhận…" : deliveryMode ? "Kết thúc giao hàng" : "Bắt đầu giao hàng"}</button>
    </div>
    <div className="trip-form-section"><div className="trip-form-title"><span>Lô hàng & Storage Profile</span><button className="btn btn-primary" type="button" onClick={openTrip} disabled={busy}>▣ Khởi tạo chuyến</button></div><p className="business-hint">Chọn lô hàng và profile, điều chỉnh ngưỡng trước khi xuất phát. Thiết bị: {deviceId}.</p></div>
    {notice}
    <dialog ref={dialog} className="business-dialog" aria-labelledby="start-trip-title" onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <div className="business-dialog-heading"><h2 id="start-trip-title">Khởi tạo chuyến & Storage Profile</h2><button className="btn btn-secondary" type="button" onClick={() => dialog.current.close()} disabled={busy} aria-label="Đóng">✕</button></div>
      {loading ? <p role="status">Đang tải lô hàng và profile…</p> : <form onSubmit={startTrip}>
        <div className="business-fields">
          <label className="form-label">Mã chuyến<input className="form-input" value={form.tripId} required maxLength={30} pattern="[A-Za-z0-9_-]+" onChange={(event) => setForm({ ...form, tripId: event.target.value })} /></label>
          <label className="form-label">Mã lô hàng<input className="form-input" list="business-lots" value={form.lotId} required maxLength={50} onChange={(event) => {
            const lotId = event.target.value;
            const lot = options.lots.find((item) => item.lot_id === lotId || item.qr_code === lotId);
            if (lot?.profile_id) selectProfile(lot.profile_id, { lotId });
            else setForm({ ...form, lotId });
          }} /><datalist id="business-lots">{options.lots.map((lot) => <option key={lot.lot_id} value={lot.lot_id} />)}</datalist></label>
          <label className="form-label business-wide">Storage Profile<select className="form-input" required value={form.profileId} onChange={(event) => selectProfile(event.target.value)}><option value="" disabled>Chọn profile</option>{options.profiles.map((item) => <option key={item.profile_id} value={item.profile_id}>{item.profile_name} ({item.profile_id})</option>)}</select></label>
          <div className="business-defaults business-wide">Ngưỡng mặc định của profile: Tmin {profile?.min_temperature ?? "chưa đặt"}°C · Tmax {profile?.max_temperature ?? "chưa đặt"}°C</div>
          <label className="form-label">Tmin thực tế (°C)<input className="form-input" type="number" min="-40" max="80" step="0.1" required value={form.min} onChange={(event) => setForm({ ...form, min: event.target.value })} /></label>
          <label className="form-label">Tmax thực tế (°C)<input className="form-input" type="number" min="-40" max="80" step="0.1" required value={form.max} onChange={(event) => setForm({ ...form, max: event.target.value })} /></label>
        </div>
        <p className="business-hint">Có thể chỉnh tay ngưỡng cho chuyến này. Chuyến bắt đầu với Delivery Mode OFF.</p>
        {notice}
        <div className="business-dialog-actions"><button className="btn btn-secondary" type="button" onClick={() => dialog.current.close()} disabled={busy}>Hủy</button><button className="btn btn-primary" type="submit" disabled={busy || !options.profiles.length}>{busy ? "Đang chờ ESP32 xác nhận…" : "▶ Bắt đầu chuyến"}</button></div>
      </form>}
    </dialog>
  </section>;
}
