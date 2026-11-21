import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";

export default function ExpensesReview() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState({});
  const [message, setMessage] = useState("");

  async function fetchExpenses() {
    setLoading(true);
    setMessage("");

    let query = supabase
      .from("expenses")
      .select("*")
      .order("slip_date", { ascending: false })
      .order("slip_time", { ascending: false });

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;

    if (error) {
      setMessage(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`);
    } else {
      const list = data || [];
      setRows(list);
      if (list.length > 0 && !selectedId) {
        selectRow(list[0]);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchExpenses();
  }, [statusFilter]);

  function selectRow(row) {
    setSelectedId(row.id);
    setDraft({ ...row });
    setMessage("");
  }

  function handleFieldChange(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave(markReviewed = false) {
    if (!selectedId) return;
    setSavingId(selectedId);
    setMessage("");

    const nextStatus = markReviewed ? "reviewed" : draft.status || "pending_review";
    const parsedAmount = Number(draft.amount ?? 0);
    const parsedFee = Number(draft.fee ?? 0);

    const payload = {
      slip_date: draft.slip_date || null,
      slip_time: draft.slip_time || null,
      amount: Number.isFinite(parsedAmount) ? parsedAmount : 0,
      fee: Number.isFinite(parsedFee) ? parsedFee : 0,
      sender_name: draft.sender_name || null,
      sender_bank: draft.sender_bank || null,
      sender_account: draft.sender_account || null,
      receiver_name: draft.receiver_name || null,
      receiver_bank: draft.receiver_bank || null,
      receiver_account: draft.receiver_account || null,
      memo: draft.memo || null,
      category: draft.category || null,
      account_code: draft.account_code || null,
      notes: draft.notes || null,
      slip_ref: draft.slip_ref || null,
      source_filename: draft.source_filename || "",
      status: nextStatus,
    };

    const { data, error } = await supabase
      .from("expenses")
      .update(payload)
      .eq("id", selectedId)
      .select()
      .single();

    if (error) {
      setMessage(`บันทึกไม่สำเร็จ: ${error.message}`);
    } else if (data) {
      setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));
      setDraft({ ...data });
      setMessage(`บันทึก ${data.source_filename} เรียบร้อยแล้ว (สถานะ: ${data.status})`);
    }

    setSavingId(null);
  }

  const filteredRows = rows.filter((r) => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return (
      (r.receiver_name || "").toLowerCase().includes(q) ||
      (r.sender_name || "").toLowerCase().includes(q) ||
      (r.memo || "").toLowerCase().includes(q) ||
      (r.category || "").toLowerCase().includes(q) ||
      (r.account_code || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q) ||
      (r.slip_ref || "").toLowerCase().includes(q) ||
      (r.source_filename || "").toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>ตรวจและแก้ไขรายการสลิป (expenses)</h2>
          <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
            ทั้งหมด {filteredRows.length} รายการ
          </div>
        </div>
        <button onClick={fetchExpenses} style={{ padding: "8px 14px", cursor: "pointer" }}>
          รีเฟรชข้อมูล
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: 8, minWidth: 180 }}
        >
          <option value="all">ทุกสถานะ</option>
          <option value="pending_review">pending_review (รอตรวจ)</option>
          <option value="reviewed">reviewed (ตรวจแล้ว)</option>
        </select>

        <input
          type="text"
          placeholder="ค้นหา ผู้รับ / ผู้โอน / memo / หมวดหมู่ / เลขสลิป / ชื่อไฟล์..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ padding: 8, flex: 1, minWidth: 260 }}
        />
      </div>

      {message && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 14,
            borderRadius: 6,
            background: message.includes("ไม่สำเร็จ") ? "#fee2e2" : "#dcfce7",
            color: message.includes("ไม่สำเร็จ") ? "#991b1b" : "#166534",
          }}
        >
          {message}
        </div>
      )}

      {loading ? (
        <div>กำลังโหลดข้อมูลจาก Supabase...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 20, alignItems: "start" }}>
          {/* ฝั่งซ้าย: ตารางรายการ */}
          <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
                  <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>วันที่/เวลา</th>
                  <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>ยอดเงิน</th>
                  <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>ผู้รับ / memo</th>
                  <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>หมวด / บัญชี</th>
                  <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const isSelected = row.id === selectedId;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => selectRow(row)}
                      style={{
                        cursor: "pointer",
                        background: isSelected ? "#eff6ff" : "#fff",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                        <div>{row.slip_date || "-"}</div>
                        <div style={{ fontSize: 11, color: "#666" }}>{row.slip_time || "-"}</div>
                      </td>
                      <td style={{ padding: 8, whiteSpace: "nowrap", fontWeight: 600 }}>
                        {Number(row.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: 8 }}>
                        <div style={{ fontWeight: 500 }}>{row.receiver_name || "-"}</div>
                        <div style={{ fontSize: 12, color: "#555" }}>{row.memo || "-"}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{row.source_filename}</div>
                      </td>
                      <td style={{ padding: 8 }}>
                        <div>{row.category || <span style={{ color: "#aaa" }}>ยังไม่ระบุ</span>}</div>
                        <div style={{ fontSize: 11, color: "#666" }}>{row.account_code || "-"}</div>
                      </td>
                      <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 11,
                            background: row.status === "reviewed" ? "#dcfce7" : "#fef3c7",
                            color: row.status === "reviewed" ? "#166534" : "#92400e",
                          }}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#777" }}>
                      ไม่พบรายการตามเงื่อนไข
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ฝั่งขวา: ฟอร์มตรวจ แก้ไข และเติมข้อมูล */}
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, background: "#fafafa" }}>
            <h3 style={{ marginTop: 0 }}>แก้ไข / เติมข้อมูลรายการ</h3>

            {!selectedId ? (
              <div style={{ color: "#777" }}>คลิกเลือกรายการทางซ้ายเพื่อแก้ไข</div>
            ) : (
              <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                <div style={{ fontSize: 12, color: "#555" }}>
                  ไฟล์ต้นฉบับ: <strong>{draft.source_filename}</strong> | เลขอ้างอิง:{" "}
                  <strong>{draft.slip_ref || "-"}</strong>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label>
                    วันที่โอน (YYYY-MM-DD)
                    <input
                      type="text"
                      value={draft.slip_date || ""}
                      onChange={(e) => handleFieldChange("slip_date", e.target.value)}
                      style={{ width: "100%", padding: 6, marginTop: 4 }}
                    />
                  </label>
                  <label>
                    เวลาโอน (HH:MM:SS)
                    <input
                      type="text"
                      value={draft.slip_time || ""}
                      onChange={(e) => handleFieldChange("slip_time", e.target.value)}
                      style={{ width: "100%", padding: 6, marginTop: 4 }}
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label>
                    ยอดเงิน (amount)
                    <input
                      type="number"
                      step="0.01"
                      value={draft.amount ?? ""}
                      onChange={(e) => handleFieldChange("amount", Number(e.target.value))}
                      style={{ width: "100%", padding: 6, marginTop: 4 }}
                    />
                  </label>
                  <label>
                    ค่าธรรมเนียม (fee)
                    <input
                      type="number"
                      step="0.01"
                      value={draft.fee ?? 0}
                      onChange={(e) => handleFieldChange("fee", Number(e.target.value))}
                      style={{ width: "100%", padding: 6, marginTop: 4 }}
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label>
                    ผู้โอน (sender_name)
                    <input
                      type="text"
                      value={draft.sender_name || ""}
                      onChange={(e) => handleFieldChange("sender_name", e.target.value)}
                      style={{ width: "100%", padding: 6, marginTop: 4 }}
                    />
                  </label>
                  <label>
                    ผู้รับ (receiver_name)
                    <input
                      type="text"
                      value={draft.receiver_name || ""}
                      onChange={(e) => handleFieldChange("receiver_name", e.target.value)}
                      style={{ width: "100%", padding: 6, marginTop: 4 }}
                    />
                  </label>
                </div>

                <label>
                  บันทึกบนสลิป (memo)
                  <input
                    type="text"
                    value={draft.memo || ""}
                    onChange={(e) => handleFieldChange("memo", e.target.value)}
                    style={{ width: "100%", padding: 6, marginTop: 4 }}
                  />
                </label>

                <hr style={{ width: "100%", border: 0, borderTop: "1px solid #ddd", margin: "4px 0" }} />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label>
                    หมวดหมู่ (category)
                    <input
                      type="text"
                      placeholder="เช่น วัตถุดิบ, บรรจุภัณฑ์, ขนส่ง"
                      value={draft.category || ""}
                      onChange={(e) => handleFieldChange("category", e.target.value)}
                      style={{ width: "100%", padding: 6, marginTop: 4 }}
                    />
                  </label>
                  <label>
                    รหัสบัญชี (account_code)
                    <input
                      type="text"
                      placeholder="เช่น 5101, 5201"
                      value={draft.account_code || ""}
                      onChange={(e) => handleFieldChange("account_code", e.target.value)}
                      style={{ width: "100%", padding: 6, marginTop: 4 }}
                    />
                  </label>
                </div>

                <label>
                  หมายเหตุเพิ่มเติม (notes)
                  <textarea
                    rows={3}
                    placeholder="ใส่รายละเอียดที่ขาดหาย หรือข้อตกลงจากการตรวจ..."
                    value={draft.notes || ""}
                    onChange={(e) => handleFieldChange("notes", e.target.value)}
                    style={{ width: "100%", padding: 6, marginTop: 4 }}
                  />
                </label>

                <label>
                  สถานะ (status)
                  <select
                    value={draft.status || "pending_review"}
                    onChange={(e) => handleFieldChange("status", e.target.value)}
                    style={{ width: "100%", padding: 6, marginTop: 4 }}
                  >
                    <option value="pending_review">pending_review</option>
                    <option value="reviewed">reviewed</option>
                  </select>
                </label>

                <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  <button
                    disabled={savingId === selectedId}
                    onClick={() => handleSave(false)}
                    style={{ padding: "8px 14px", cursor: "pointer" }}
                  >
                    {savingId === selectedId ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
                  </button>
                  <button
                    disabled={savingId === selectedId}
                    onClick={() => handleSave(true)}
                    style={{
                      padding: "8px 14px",
                      cursor: "pointer",
                      background: "#16a34a",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                    }}
                  >
                    {savingId === selectedId ? "กำลังบันทึก..." : "บันทึกและทำเครื่องหมายว่าตรวจแล้ว"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}