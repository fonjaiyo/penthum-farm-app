import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'

export default function ExpensesReview() {
  const [expenses, setExpenses] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [message, setMessage] = useState(null)

  // Filters & Pagination
  const [statusFilter, setStatusFilter] = useState('pending_review') // pending_review | reviewed | all
  const [methodFilter, setMethodFilter] = useState('all') // all | transfer | cash
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(5)

  // Inline edits for existing rows
  const [rowAccounts, setRowAccounts] = useState({})
  const [rowNotes, setRowNotes] = useState({})

  // Cash Expense Modal / Drawer Form
  const [showCashForm, setShowCashForm] = useState(false)
  const [savingCash, setSavingCash] = useState(false)
  const [cashForm, setCashForm] = useState({
    slip_date: new Date().toISOString().slice(0, 10),
    amount: '',
    memo: '',
    receiver_name: '',
    account_code: '',
    notes: ''
  })

  function showToast(type, text) {
    setMessage({ type, text })
  }

  async function fetchData() {
    setLoading(true)
    try {
      const [expRes, accRes] = await Promise.all([
        supabase
          .from('expenses')
          .select('*')
          .order('slip_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(300),
        supabase
          .from('chart_of_accounts')
          .select('*')
          .order('code', { ascending: true })
      ])

      if (expRes.error) throw expRes.error
      if (accRes.error) throw accRes.error

      const expList = expRes.data || []
      const accList = (accRes.data || []).filter(a => a.is_active !== false)

      setExpenses(expList)
      setAccounts(accList)

      const initAcc = {}
      const initNotes = {}
      expList.forEach(item => {
        initAcc[item.id] = item.account_code || ''
        initNotes[item.id] = item.notes || ''
      })
      setRowAccounts(initAcc)
      setRowNotes(initNotes)
    } catch (err) {
      console.error('Error loading expenses:', err)
      showToast('error', `โหลดข้อมูลไม่สำเร็จ: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const accountByCode = useMemo(() => {
    const map = {}
    accounts.forEach(a => {
      map[a.code] = a
    })
    return map
  }, [accounts])

  // จัดกลุ่มผังบัญชีให้ตรงกับ Dropdown เดิมของพี่โย
  const groupedAccounts = useMemo(() => {
    const expenseGroup = []
    const assetGroup = []
    const otherGroup = []

    accounts.forEach(a => {
      const codeStr = String(a.code || '')
      if (codeStr.startsWith('5')) {
        expenseGroup.push(a)
      } else if (codeStr.startsWith('1')) {
        assetGroup.push(a)
      } else {
        otherGroup.push(a)
      }
    })

    return { expenseGroup, assetGroup, otherGroup }
  }, [accounts])

  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase()
    return expenses.filter(item => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (methodFilter !== 'all' && (item.payment_method || 'transfer') !== methodFilter) {
        return false
      }
      if (!q) return true

      return (
        String(item.receiver_name || '').toLowerCase().includes(q) ||
        String(item.sender_name || '').toLowerCase().includes(q) ||
        String(item.memo || '').toLowerCase().includes(q) ||
        String(item.source_filename || '').toLowerCase().includes(q) ||
        String(item.notes || '').toLowerCase().includes(q)
      )
    })
  }, [expenses, statusFilter, methodFilter, search])

  const visibleExpenses = useMemo(() => {
    if (pageSize === 'all') return filteredExpenses
    return filteredExpenses.slice(0, Number(pageSize))
  }, [filteredExpenses, pageSize])

  async function handleSaveRow(item, newAccountCode, newNote) {
    const selectedAcc = accountByCode[newAccountCode]
    const nextStatus = newAccountCode ? 'reviewed' : 'pending_review'

    setSavingId(item.id)
    try {
      const { error } = await supabase
        .from('expenses')
        .update({
          account_code: newAccountCode || null,
          category: selectedAcc ? selectedAcc.category : null,
          notes: (newNote || '').trim() || null,
          status: nextStatus
        })
        .eq('id', item.id)

      if (error) throw error

      setExpenses(prev =>
        prev.map(e =>
          e.id === item.id
            ? {
                ...e,
                account_code: newAccountCode || null,
                category: selectedAcc ? selectedAcc.category : null,
                notes: (newNote || '').trim() || null,
                status: nextStatus
              }
            : e
        )
      )
      showToast('success', '✅ บันทึกประเภทการจ่ายเงินเรียบร้อยแล้ว')
    } catch (err) {
      console.error('Error updating expense:', err)
      showToast('error', `บันทึกไม่สำเร็จ: ${err.message}`)
    } finally {
      setSavingId(null)
    }
  }

  async function handleCreateCashExpense(e) {
    e.preventDefault()

    const amt = Number(cashForm.amount)
    if (!cashForm.slip_date) {
      showToast('error', 'กรุณาระบุวันที่จ่ายเงินสดครับ')
      return
    }
    if (Number.isNaN(amt) || amt <= 0) {
      showToast('error', 'กรุณาระบุยอดเงินที่มากกว่า 0 บาทครับ')
      return
    }
    if (!cashForm.memo.trim()) {
      showToast('error', 'กรุณาระบุรายการที่จ่าย (เช่น ค่าแรง, ซื้อของ, ค่าน้ำมัน) ครับ')
      return
    }
    if (!cashForm.account_code) {
      showToast('error', 'กรุณาเลือกประเภทการจ่ายเงิน / เลขที่บัญชีครับ')
      return
    }

    const selectedAcc = accountByCode[cashForm.account_code]
    const nowIso = `${cashForm.slip_date}T12:00:00+07:00`

    setSavingCash(true)
    try {
      const payload = {
        slip_date: cashForm.slip_date,
        transfer_at: nowIso,
        amount: Number(amt.toFixed(2)),
        fee: 0,
        payment_method: 'cash',
        sender_name: 'เงินสดฟาร์ม',
        receiver_name: cashForm.receiver_name.trim() || null,
        memo: cashForm.memo.trim(),
        account_code: cashForm.account_code,
        category: selectedAcc ? selectedAcc.category : null,
        notes: cashForm.notes.trim() || null,
        slip_ref: null, // เงินสดไม่มีเลขสลิป ปล่อย null เพื่อไม่ติด unique constraint
        source_filename: `cash-${cashForm.slip_date}`,
        status: 'reviewed'
      }

      const { error } = await supabase.from('expenses').insert([payload])
      if (error) throw error

      setCashForm({
        slip_date: new Date().toISOString().slice(0, 10),
        amount: '',
        memo: '',
        receiver_name: '',
        account_code: '',
        notes: ''
      })
      setShowCashForm(false)
      await fetchData()
      showToast('success', `✅ บันทึกรายจ่ายเงินสด "${payload.memo}" (${amt.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท) เรียบร้อยแล้ว`)
    } catch (err) {
      console.error('Error saving cash expense:', err)
      showToast('error', `บันทึกรายจ่ายเงินสดไม่สำเร็จ: ${err.message}`)
    } finally {
      setSavingCash(false)
    }
  }

  function renderAccountOptions() {
    return (
      <>
        <option value="">-- เลือกประเภทการจ่ายเงิน --</option>
        {groupedAccounts.expenseGroup.length > 0 && (
          <optgroup label="หมวดค่าใช้จ่าย">
            {groupedAccounts.expenseGroup.map(a => (
              <option key={a.code} value={a.code}>
                {a.category || a.name_th} ({a.code})
              </option>
            ))}
          </optgroup>
        )}
        {groupedAccounts.assetGroup.length > 0 && (
          <optgroup label="หมวดสินทรัพย์ / ปรับปรุงสถานที่">
            {groupedAccounts.assetGroup.map(a => (
              <option key={a.code} value={a.code}>
                {a.category || a.name_th} ({a.code})
              </option>
            ))}
          </optgroup>
        )}
        {groupedAccounts.otherGroup.length > 0 && (
          <optgroup label="อื่นๆ">
            {groupedAccounts.otherGroup.map(a => (
              <option key={a.code} value={a.code}>
                {a.category || a.name_th} ({a.code})
              </option>
            ))}
          </optgroup>
        )}
      </>
    )
  }

  function formatMoney(val) {
    return Number(val || 0).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }

  const cardStyle = {
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    color: '#1e293b'
  }

  const thStyle = {
    padding: '10px 8px',
    border: '1px solid #cbd5e1',
    background: '#e6f4ea',
    color: '#0f172a',
    fontSize: '13px',
    fontWeight: 'bold'
  }

  const tdStyle = {
    padding: '10px 8px',
    border: '1px solid #e2e8f0',
    fontSize: '13px',
    color: '#1e293b',
    verticalAlign: 'middle'
  }

  const lightInputStyle = {
    padding: '8px 10px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#1e293b',
    fontSize: '13px',
    boxSizing: 'border-box',
    width: '100%'
  }

  return (
    <div style={{ color: '#1e293b' }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#0f766e' }}>🧾 ตรวจสลิปและลงประเภทการจ่ายเงิน</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#475569' }}>
            กำลังแสดง {visibleExpenses.length} จากทั้งหมด {filteredExpenses.length} รายการ (รวมโอนเงินและเงินสด)
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowCashForm(prev => !prev)}
            style={{
              padding: '9px 14px',
              borderRadius: '6px',
              border: 'none',
              background: showCashForm ? '#64748b' : '#d97706',
              color: '#ffffff',
              fontWeight: 'bold',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            {showCashForm ? '✖ ปิดฟอร์มเงินสด' : '+ 💵 บันทึกรายจ่ายเงินสด'}
          </button>

          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            style={{
              padding: '9px 14px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#0284c7',
              fontWeight: 'bold',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            🔄 รีเฟรช
          </button>
        </div>
      </div>

      {/* Toast Message */}
      {message && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '6px',
            marginBottom: '14px',
            fontWeight: 'bold',
            fontSize: '13px',
            background: message.type === 'error' ? '#fee2e2' : '#dcfce7',
            border: `1px solid ${message.type === 'error' ? '#fca5a5' : '#86efac'}`,
            color: message.type === 'error' ? '#991b1b' : '#166534'
          }}
        >
          {message.text}
        </div>
      )}

      {/* Cash Expense Form (Collapsible) */}
      {showCashForm && (
        <form
          onSubmit={handleCreateCashExpense}
          style={{
            ...cardStyle,
            background: '#fffbeb',
            border: '2px solid #f59e0b'
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '12px', color: '#92400e' }}>
            💵 บันทึกรายจ่ายที่จ่ายด้วยเงินสด (ไม่ต้องมีสลิปโอน)
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>
                วันที่จ่ายเงิน *
              </label>
              <input
                type="date"
                value={cashForm.slip_date}
                onChange={e => setCashForm(prev => ({ ...prev, slip_date: e.target.value }))}
                required
                style={lightInputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>
                ยอดเงินสด (บาท) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={cashForm.amount}
                onChange={e => setCashForm(prev => ({ ...prev, amount: e.target.value }))}
                placeholder="0.00"
                required
                style={{ ...lightInputStyle, textAlign: 'right', fontWeight: 'bold' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>
                รายการที่จ่าย (Memo) *
              </label>
              <input
                type="text"
                value={cashForm.memo}
                onChange={e => setCashForm(prev => ({ ...prev, memo: e.target.value }))}
                placeholder="เช่น ซื้อปุ๋ย, ค่าน้ำมัน, ค่าแรงรายวัน"
                required
                style={lightInputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>
                ประเภทการจ่ายเงิน / เลขที่บัญชี *
              </label>
              <select
                value={cashForm.account_code}
                onChange={e => setCashForm(prev => ({ ...prev, account_code: e.target.value }))}
                required
                style={lightInputStyle}
              >
                {renderAccountOptions()}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>
                ร้านค้า / ผู้รับเงิน (ไม่บังคับ)
              </label>
              <input
                type="text"
                value={cashForm.receiver_name}
                onChange={e => setCashForm(prev => ({ ...prev, receiver_name: e.target.value }))}
                placeholder="เช่น ร้านเกษตรปากช่อง / ลุงสมชาย"
                style={lightInputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>
                หมายเหตุเพิ่มเติม / ปริมาณที่ซื้อ (ไม่บังคับ)
              </label>
              <input
                type="text"
                value={cashForm.notes}
                onChange={e => setCashForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="เช่น 2 กระสอบ / จ่ายสดหน้าฟาร์ม"
                style={lightInputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setShowCashForm(false)}
              style={{
                padding: '9px 16px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={savingCash}
              style={{
                padding: '9px 20px',
                borderRadius: '6px',
                border: 'none',
                background: '#15803d',
                color: '#ffffff',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              {savingCash ? 'กำลังบันทึก...' : '💾 บันทึกรายจ่ายเงินสด'}
            </button>
          </div>
        </form>
      )}

      {/* Filter Bar */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
          {/* Status Tabs */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setStatusFilter('pending_review')}
              style={{
                padding: '7px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: statusFilter === 'pending_review' ? '#f59e0b' : '#ffffff',
                color: statusFilter === 'pending_review' ? '#ffffff' : '#334155',
                fontWeight: 'bold',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              ⏳ รอตรวจ (pending_review)
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('reviewed')}
              style={{
                padding: '7px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: statusFilter === 'reviewed' ? '#2e7d32' : '#ffffff',
                color: statusFilter === 'reviewed' ? '#ffffff' : '#334155',
                fontWeight: 'bold',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              ✅ ตรวจแล้ว (reviewed)
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              style={{
                padding: '7px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: statusFilter === 'all' ? '#1e293b' : '#ffffff',
                color: statusFilter === 'all' ? '#ffffff' : '#334155',
                fontWeight: 'bold',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              ทั้งหมด
            </button>
          </div>

          {/* Payment Method Filter & Page Size */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <select
              value={methodFilter}
              onChange={e => setMethodFilter(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#1e293b',
                fontSize: '13px',
                fontWeight: 'bold'
              }}
            >
              <option value="all">ทุกช่องทาง (โอน + เงินสด)</option>
              <option value="transfer">🏦 เฉพาะโอนเงิน</option>
              <option value="cash">💵 เฉพาะเงินสด</option>
            </select>

            <span style={{ fontSize: '13px', color: '#475569' }}>แสดงรอบละ:</span>
            {[5, 10, 'all'].map(sz => (
              <button
                key={String(sz)}
                type="button"
                onClick={() => setPageSize(sz)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: pageSize === sz ? '#2563eb' : '#ffffff',
                  color: pageSize === sz ? '#ffffff' : '#334155',
                  fontWeight: 'bold',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                {sz === 'all' ? 'ทั้งหมด' : `${sz} รายการ`}
              </button>
            ))}
          </div>
        </div>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 ค้นหา ผู้รับ / ผู้โอน / memo / ชื่อไฟล์..."
          style={lightInputStyle}
        />
      </div>

      {/* Table */}
      <div style={cardStyle}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#64748b' }}>กำลังโหลดข้อมูลรายจ่าย...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: '45px', textAlign: 'center' }}>#</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: '115px' }}>วันที่ / เวลา</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: '110px' }}>ยอดเงิน (บาท)</th>
                  <th style={{ ...thStyle, textAlign: 'left', width: '170px' }}>ช่องทาง / ผู้รับ</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>บันทึก (memo) / ไฟล์</th>
                  <th style={{ ...thStyle, textAlign: 'left', width: '180px' }}>หมายเหตุเพิ่มเติม (ถ้ามี)</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: '250px' }}>ประเภทการจ่ายเงิน / เลขที่บัญชี</th>
                </tr>
              </thead>
              <tbody>
                {visibleExpenses.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ ...tdStyle, textAlign: 'center', padding: '20px', color: '#64748b' }}>
                      ไม่พบรายการจ่ายเงินตามเงื่อนไขที่เลือกครับ
                    </td>
                  </tr>
                ) : (
                  visibleExpenses.map((item, idx) => {
                    const isCash = item.payment_method === 'cash'
                    const currentAcc = rowAccounts[item.id] ?? ''
                    const currentNote = rowNotes[item.id] ?? ''
                    const selectedAccObj = accountByCode[currentAcc]

                    return (
                      <tr key={item.id} style={{ background: isCash ? '#fffbeb' : '#ffffff' }}>
                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold' }}>{idx + 1}</td>

                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <div style={{ fontWeight: 'bold' }}>{item.slip_date || '-'}</div>
                          {!isCash && item.slip_time && (
                            <div style={{ fontSize: '11px', color: '#64748b' }}>{item.slip_time}</div>
                          )}
                        </td>

                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', fontSize: '15px' }}>
                          {formatMoney(item.amount)}
                        </td>

                        <td style={tdStyle}>
                          {isCash ? (
                            <>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 7px',
                                  borderRadius: '4px',
                                  background: '#fef3c7',
                                  border: '1px solid #f59e0b',
                                  color: '#92400e',
                                  fontSize: '11px',
                                  fontWeight: 'bold',
                                  marginBottom: '4px'
                                }}
                              >
                                💵 จ่ายเงินสด
                              </span>
                              <div style={{ fontSize: '12px', fontWeight: 'bold' }}>
                                {item.receiver_name ? `ถึง: ${item.receiver_name}` : 'จ่ายสดหน้างาน'}
                              </div>
                            </>
                          ) : (
                            <>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>
                                จาก: {item.sender_name || '-'}
                              </div>
                              <div style={{ fontWeight: 'bold', marginTop: '2px' }}>
                                ถึง: {item.receiver_name || '-'}
                              </div>
                            </>
                          )}
                        </td>

                        <td style={tdStyle}>
                          <div style={{ fontWeight: 'bold', color: '#0f766e', fontSize: '14px' }}>
                            {item.memo || '-'}
                          </div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                            {isCash
                              ? `อ้างอิง: ${item.source_filename}`
                              : `ไฟล์: ${item.source_filename}${item.slip_ref ? ` | Ref: ${item.slip_ref}` : ''}`}
                          </div>
                        </td>

                        <td style={tdStyle}>
                          <input
                            type="text"
                            value={currentNote}
                            onChange={e =>
                              setRowNotes(prev => ({ ...prev, [item.id]: e.target.value }))
                            }
                            onBlur={() => {
                              if ((item.notes || '') !== currentNote) {
                                handleSaveRow(item, currentAcc, currentNote)
                              }
                            }}
                            placeholder="โน้ตสั้นๆ (ไม่บังคับ)"
                            style={{ ...lightInputStyle, padding: '6px 8px' }}
                          />
                        </td>

                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <select
                            value={currentAcc}
                            disabled={savingId === item.id}
                            onChange={e => {
                              const nextCode = e.target.value
                              setRowAccounts(prev => ({ ...prev, [item.id]: nextCode }))
                              handleSaveRow(item, nextCode, currentNote)
                            }}
                            style={{
                              ...lightInputStyle,
                              fontWeight: 'bold',
                              border: currentAcc ? '2px solid #16a34a' : '1px solid #cbd5e1',
                              padding: '7px 8px'
                            }}
                          >
                            {renderAccountOptions()}
                          </select>

                          {selectedAccObj ? (
                            <div style={{ fontSize: '11px', color: '#15803d', fontWeight: 'bold', marginTop: '4px' }}>
                              เลขที่บัญชี {selectedAccObj.code} : {selectedAccObj.name_th}
                            </div>
                          ) : (
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                              ยังไม่ระบุเลขที่บัญชี (ข้ามได้ ระบบจะยังไม่บันทึกแถวนี้)
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}