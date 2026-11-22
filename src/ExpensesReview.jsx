import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";

export default function ExpensesReview() {
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingBatch, setSavingBatch] = useState(false);

  // ตัวกรองและจำนวนแสดงต่อรอบ (ค่าเริ่มต้น: รอตรวจ ครั้งละ 5 รายการ)
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [batchLimit, setBatchLimit] = useState(5); // 5 | 10 | 0 (0 = ทั้งหมด)
  const [searchText, setSearchText] = useState("");

  // เก็บค่าที่เลือก/แก้ไขชั่วคราวรายแถว: { [id]: { account_code, notes } }
  const [selections, setSelections] = useState({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadInitialData();
  }, [statusFilter]);

  async function loadInitialData() {
    setLoading(true);
    setMessage("");

    try {
      const [accountsRes, expensesRes] = await Promise.all([
        supabase
          .from("chart_of_accounts")
          .select("code, name_th, category, account_type, keywords, sort_order, is_active")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("code", { ascending: true }),
        buildExpensesQuery(),
      ]);

      if (accountsRes.error) {
        throw new Error(`โหลดผังบัญชีไม่สำเร็จ: ${accountsRes.error.message}`);
      }
      if (expensesRes.error) {
        throw new Error(`โหลดรายการสลิปไม่สำเร็จ: ${expensesRes.error.message}`);
      }

      const accList = accountsRes.data || [];
      const expList = expensesRes.data || [];

      setAccounts(accList);
      setRows(expList);

      // ตั้งค่าเริ่มต้นใน state ให้ตรงกับค่าเดิมที่มีในฐานข้อมูล (ถ้ามี)
      const initialSelections = {};
      expList.forEach((r) => {
        initialSelections[r.id] = {
          account_code: r.account_code || "",
          notes: r.notes || "",
        };
      });
      setSelections(initialSelections);
    } catch (err) {
      setMessage(`❌ ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function buildExpensesQuery() {
    let query = supabase
      .from("expenses")
      .select("*")
      .order("slip_date", { ascending: false })
      .order("slip_time", { ascending: false });

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }
    return query;
  }

  function handleSelectAccount(rowId, accountCode) {
    setSelections((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || { notes: "" }),
        account_code: accountCode,
      },
    }));
  }

  function handleNotesChange(rowId, notesValue) {
    setSelections((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || { account_code: "" }),
        notes: notesValue,
      },
    }));
  }

  // กรองตามคำค้นหาก่อน แล้วค่อยตัดจำนวนแสดงตาม batchLimit (5 หรือ 10 รายการ)
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

  const displayedRows =
    batchLimit > 0 ? filteredRows.slice(0, batchLimit) : filteredRows;

  // หาข้อมูลผังบัญชีจากรหัสบัญชี
  function getAccountByCode(code) {
    if (!code) return null;
    return accounts.find((a) => a.code === code) || null;
  }

  // รวบรวมเฉพาะแถวที่แสดงอยู่และมีการเลือกประเภทการจ่ายเงินแล้ว (และมีอะไรเปลี่ยนหรือยังเป็น pending_review)
  const readyToSaveRows = displayedRows.filter((row) => {
    const sel = selections[row.id];
    if (!sel || !sel.account_code) return false;
    const acc = getAccountByCode(sel.account_code);
    if (!acc) return false;

    const isPending = row.status !== "reviewed";
    const codeChanged = (row.account_code || "") !== sel.account_code;
    const notesChanged = (row.notes || "") !== (sel.notes || "");

    return isPending || codeChanged || notesChanged;
  });

  const readyTotalAmount = readyToSaveRows.reduce(
    (sum, r) => sum + (Number(r.amount) || 0),
    0
  );

  async function handleSaveAllSelected() {
    if (readyToSaveRows.length === 0) {
      setMessage("⚠️ กรุณาเลือกประเภทการจ่ายเงินอย่างน้อย 1 รายการก่อนกดบันทึกครับ");
      return;
    }

    setSavingBatch(true);
    setMessage("");

    try {
      const updatePromises = readyToSaveRows.map((row) => {
        const sel = selections[row.id];
        const acc = getAccountByCode(sel.account_code);

        return supabase
          .from("expenses")
          .update({
            account_code: acc.code,
            category: acc.category,
            notes: sel.notes?.trim() ? sel.notes.trim() : null,
            status: "reviewed",
          })
          .eq("id", row.id);
      });

      const results = await Promise.all(updatePromises);
      const firstError = results.find((res) => res.error)?.error;
      if (firstError) {
        throw firstError;
      }

      const savedCount = readyToSaveRows.length;
      await loadInitialData();
      setMessage(`✅ บันทึกประเภทและเลขที่บัญชีเรียบร้อยแล้ว ${savedCount} รายการ!`);
    } catch (err) {
      setMessage(`❌ บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setSavingBatch(false);
    }
  }

  // จัดกลุ่มตัวเลือกใน Dropdown ตาม account_type เพื่อให้อ่านง่าย
  const expenseAccounts = accounts.filter((a) => a.account_type === "expense");
  const assetAccounts = accounts.filter((a) => a.account_type === "asset");
  const otherAccounts = accounts.filter(
    (a) => a.account_type !== "expense" && a.account_type !== "asset"
  );

  const toggleBtnStyle = (active, activeBg = "#0f766e") => ({
    padding: "8px 12px",
    borderRadius: "6px",
    border: active ? "none" : "1px solid #ccc",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "13px",
    background: active ? activeBg : "#ffffff",
    color: active ? "#ffffff" : "#333333",
  });

  return (
    <div style={{ fontFamily: "sans-serif", color: "#222" }}>
      {/* ส่วนหัว */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "14px",
        }}
      >
        <div>
          <h2 style={{ margin: 0, color: "#0f766e" }}>🧾 ตรวจสลิปและลงประเภทการจ่ายเงิน</h2>
          <div style={{ fontSize: "13px", color: "#555", marginTop: "4px" }}>
            กำลังแสดง <b>{displayedRows.length}</b> จากทั้งหมด <b>{filteredRows.length}</b> รายการ
            {statusFilter === "pending_review" ? " (เฉพาะรายการรอตรวจ)" : ""}
          </div>
        </div>

        <button
          type="button"
          onClick={loadInitialData}
          disabled={loading || savingBatch}
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            border: "1px solid #bbb",
            background: "#f8fafc",
            cursor: "pointer",
            fontWeight: "bold",
            fontSize: "13px",
          }}
        >
          🔄 รีเฟรชข้อมูล
        </button>
      </div>

      {/* แถบควบคุม: สถานะ + จำนวนต่อหน้า (5 / 10 / ทั้งหมด) + ค้นหา */}
      <div
        style={{
          background: "#f5f5f5",
          padding: "12px",
          borderRadius: "8px",
          border: "1px solid #ddd",
          marginBottom: "16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setStatusFilter("pending_review")}
            style={toggleBtnStyle(statusFilter === "pending_review", "#0f766e")}
          >
            ⏳ รอตรวจ (pending_review)
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("reviewed")}
            style={toggleBtnStyle(statusFilter === "reviewed", "#2e7d32")}
          >
            ✅ ตรวจแล้ว (reviewed)
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            style={toggleBtnStyle(statusFilter === "all", "#475569")}
          >
            ทั้งหมด
          </button>
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "13px", fontWeight: "bold", color: "#555" }}>แสดงรอบละ:</span>
          <button
            type="button"
            onClick={() => setBatchLimit(5)}
            style={toggleBtnStyle(batchLimit === 5, "#1565c0")}
          >
            5 รายการ
          </button>
          <button
            type="button"
            onClick={() => setBatchLimit(10)}
            style={toggleBtnStyle(batchLimit === 10, "#1565c0")}
          >
            10 รายการ
          </button>
          <button
            type="button"
            onClick={() => setBatchLimit(0)}
            style={toggleBtnStyle(batchLimit === 0, "#1565c0")}
          >
            ทั้งหมด
          </button>
        </div>

        <input
          type="text"
          placeholder="🔍 ค้นหา ผู้รับ / ผู้โอน / memo / ชื่อไฟล์..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            minWidth: "240px",
            flex: "1 1 240px",
            fontSize: "14px",
          }}
        />
      </div>

      {/* ข้อความแจ้งเตือน */}
      {message && (
        <div
          style={{
            padding: "12px 14px",
            marginBottom: "16px",
            borderRadius: "6px",
            fontWeight: "bold",
            background: message.includes("❌") || message.includes("⚠️") ? "#fff3cd" : "#dcfce7",
            border: message.includes("❌") || message.includes("⚠️") ? "1px solid #ffeeba" : "1px solid #bbf7d0",
            color: message.includes("❌") ? "#991b1b" : message.includes("⚠️") ? "#854d0e" : "#166534",
          }}
        >
          {message}
        </div>
      )}

      {/* ตารางรายการสลิป */}
      {loading ? (
        <div style={{ padding: "20px", textAlign: "center" }}>กำลังโหลดข้อมูลจาก Supabase...</div>
      ) : (
        <>
          <div style={{ overflowX: "auto", marginBottom: "20px" }}>
            <table
              border="1"
              cellPadding="8"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: "#ffffff",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr style={{ background: "#e0f2f1", color: "#004d40" }}>
                  <th style={{ width: "44px" }}>#</th>
                  <th style={{ width: "110px" }}>วันที่ / เวลา</th>
                  <th style={{ width: "115px" }}>ยอดเงิน (บาท)</th>
                  <th>ผู้โอน ➔ ผู้รับ</th>
                  <th>บันทึกบนสลิป (memo) / ไฟล์</th>
                  <th style={{ width: "190px" }}>หมายเหตุเพิ่มเติม (ถ้ามี)</th>
                  <th style={{ width: "260px" }}>ประเภทการจ่ายเงิน / เลขที่บัญชี</th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: "center", padding: "24px", color: "#666" }}>
                      {statusFilter === "pending_review"
                        ? "🎉 ไม่มีรายการสลิปค้างตรวจแล้วครับ"
                        : "ไม่พบรายการตามเงื่อนไข"}
                    </td>
                  </tr>
                ) : (
                  displayedRows.map((row, idx) => {
                    const currentSel = selections[row.id] || { account_code: "", notes: "" };
                    const matchedAccount = getAccountByCode(currentSel.account_code);
                    const isPicked = Boolean(matchedAccount);

                    return (
                      <tr
                        key={row.id}
                        style={{
                          background: isPicked ? "#f0fdf4" : "#ffffff",
                        }}
                      >
                        <td style={{ textAlign: "center", fontWeight: "bold", color: "#555" }}>
                          {idx + 1}
                        </td>

                        <td style={{ whiteSpace: "nowrap" }}>
                          <div style={{ fontWeight: "bold" }}>{row.slip_date || "-"}</div>
                          <div style={{ fontSize: "12px", color: "#666" }}>{row.slip_time || "-"}</div>
                        </td>

                        <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: "bold", fontSize: "15px", color: "#111" }}>
                          {Number(row.amount || 0).toLocaleString("th-TH", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                          {Number(row.fee) > 0 && (
                            <div style={{ fontSize: "11px", color: "#b45309", fontWeight: "normal" }}>
                              ค่าธรรมเนียม {Number(row.fee).toLocaleString()}
                            </div>
                          )}
                        </td>

                        <td>
                          <div style={{ fontSize: "12px", color: "#666" }}>
                            จาก: {row.sender_name || "-"}
                          </div>
                          <div style={{ fontWeight: "bold", color: "#111", marginTop: "2px" }}>
                            ถึง: {row.receiver_name || "-"}
                          </div>
                        </td>

                        <td>
                          <div style={{ fontWeight: "bold", color: "#0f766e" }}>
                            {row.memo || <span style={{ color: "#aaa", fontWeight: "normal" }}>- ไม่มี memo -</span>}
                          </div>
                          <div style={{ fontSize: "11px", color: "#777", marginTop: "3px" }}>
                            ไฟล์: {row.source_filename || "-"}
                            {row.slip_ref ? ` | Ref: ${row.slip_ref}` : ""}
                          </div>
                        </td>

                        <td>
                          <input
                            type="text"
                            value={currentSel.notes}
                            onChange={(e) => handleNotesChange(row.id, e.target.value)}
                            placeholder="โน้ตสั้นๆ (ไม่บังคับ)"
                            style={{
                              width: "100%",
                              padding: "7px",
                              boxSizing: "border-box",
                              fontSize: "13px",
                              borderRadius: "4px",
                              border: "1px solid #ccc",
                            }}
                          />
                        </td>

                        <td>
                          <select
                            value={currentSel.account_code}
                            onChange={(e) => handleSelectAccount(row.id, e.target.value)}
                            style={{
                              width: "100%",
                              padding: "8px",
                              fontSize: "14px",
                              fontWeight: isPicked ? "bold" : "normal",
                              borderRadius: "5px",
                              border: isPicked ? "2px solid #16a34a" : "1px solid #999",
                              background: "#ffffff",
                              color: "#111",
                              cursor: "pointer",
                            }}
                          >
                            <option value="">-- เลือกประเภทการจ่ายเงิน --</option>

                            {expenseAccounts.length > 0 && (
                              <optgroup label="หมวดค่าใช้จ่าย">
                                {expenseAccounts.map((acc) => (
                                  <option key={acc.code} value={acc.code}>
                                    {acc.category} ({acc.code})
                                  </option>
                                ))}
                              </optgroup>
                            )}

                            {assetAccounts.length > 0 && (
                              <optgroup label="หมวดสินทรัพย์ / ปรับปรุงสถานที่">
                                {assetAccounts.map((acc) => (
                                  <option key={acc.code} value={acc.code}>
                                    {acc.category} ({acc.code})
                                  </option>
                                ))}
                              </optgroup>
                            )}

                            {otherAccounts.length > 0 && (
                              <optgroup label="อื่นๆ">
                                {otherAccounts.map((acc) => (
                                  <option key={acc.code} value={acc.code}>
                                    {acc.category} ({acc.code})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>

                          {matchedAccount ? (
                            <div style={{ fontSize: "12px", color: "#15803d", marginTop: "4px", fontWeight: "bold" }}>
                              เลขที่บัญชี {matchedAccount.code} : {matchedAccount.name_th}
                            </div>
                          ) : (
                            <div style={{ fontSize: "11px", color: "#888", marginTop: "4px" }}>
                              ยังไม่ระบุเลขที่บัญชี (ข้ามได้ ระบบจะยังไม่บันทึกแถวนี้)
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* แถบสรุปและปุ่ม Save ด้านล่าง (คล้ายหน้าบันทึกคำสั่งซื้อ) */}
          {displayedRows.length > 0 && (
            <div
              style={{
                background: "#e3f2fd",
                padding: "16px",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px",
                border: "1px solid #bbdefb",
              }}
            >
              <div>
                <h3 style={{ margin: 0, color: "#0d47a1" }}>
                  เลือกประเภทแล้ว: {readyToSaveRows.length} / {displayedRows.length} รายการ
                </h3>
                <div style={{ fontSize: "13px", color: "#1e3a8a", marginTop: "4px" }}>
                  ยอดเงินรวมรายการที่กำลังจะบันทึก:{" "}
                  <b>
                    {readyTotalAmount.toLocaleString("th-TH", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    บาท
                  </b>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSaveAllSelected}
                disabled={savingBatch || readyToSaveRows.length === 0}
                style={{
                  background: readyToSaveRows.length === 0 ? "#94a3b8" : "#1565c0",
                  color: "white",
                  padding: "12px 24px",
                  border: "none",
                  borderRadius: "6px",
                  cursor: readyToSaveRows.length === 0 ? "not-allowed" : "pointer",
                  fontSize: "16px",
                  fontWeight: "bold",
                }}
              >
                {savingBatch
                  ? "กำลังบันทึก..."
                  : `💾 บันทึกทั้งหมดที่เลือกไว้ (${readyToSaveRows.length} รายการ)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}