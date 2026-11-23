import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'

export default function StockCountManager() {
  const [products, setProducts] = useState([])
  const [bomCosts, setBomCosts] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  // ค่าที่ฝน/จ๋ายกรอกจากการนับจริง (key = product.id)
  const [countedInputs, setCountedInputs] = useState({})
  const [rowNotes, setRowNotes] = useState({})
  const [batchNote, setBatchNote] = useState('')
  const [search, setSearch] = useState('')

  function showToast(type, text) {
    setMessage({ type, text })
  }

  async function fetchAllData() {
    setLoading(true)
    try {
      const [prodRes, costRes, movRes] = await Promise.all([
        supabase.from('products').select('*').order('sku', { ascending: true }),
        supabase.from('v_product_bom_cost_summary').select('sku, total_cost_per_unit'),
        supabase
          .from('inventory_movements')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200)
      ])

      if (prodRes.error) throw prodRes.error
      if (costRes.error) throw costRes.error
      if (movRes.error) throw movRes.error

      setProducts(prodRes.data || [])
      setBomCosts(costRes.data || [])
      setMovements(movRes.data || [])
    } catch (err) {
      console.error('Error loading stock data:', err)
      showToast('error', `โหลดข้อมูลสต็อกไม่สำเร็จ: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAllData()
  }, [])

  // รวมต้นทุนจาก BOM ต่อ SKU
  const bomCostBySku = useMemo(() => {
    const map = {}
    bomCosts.forEach(c => {
      map[c.sku] = Number(c.total_cost_per_unit) || 0
    })
    return map
  }, [bomCosts])

  // คำนวณยอดคงเหลือปัจจุบันในระบบจาก inventory_movements (IN / OUT / ADJUST)
  const currentStockByProductId = useMemo(() => {
    const map = {}
    movements.forEach(m => {
      if (!m.product_id) return
      const qty = Number(m.quantity) || 0
      if (!map[m.product_id]) map[m.product_id] = 0

      if (m.movement_type === 'IN') {
        map[m.product_id] += qty
      } else if (m.movement_type === 'OUT') {
        map[m.product_id] -= qty
      } else if (m.movement_type === 'ADJUST') {
        // ADJUST เก็บค่าผลต่าง (+ เพิ่ม / - ลด)
        map[m.product_id] += qty
      }
    })
    return map
  }, [movements])

  const activeProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products
      .filter(p => p.is_active !== false)
      .filter(
        p =>
          !q ||
          p.sku.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q)
      )
  }, [products, search])

  // สรุปมูลค่าสต็อกคงเหลือตามต้นทุน BOM
  const stockSummary = useMemo(() => {
    let totalUnits = 0
    let totalValue = 0

    products
      .filter(p => p.is_active !== false)
      .forEach(p => {
        const stock = currentStockByProductId[p.id] || 0
        const unitCost = bomCostBySku[p.sku] || 0
        if (stock > 0) {
          totalUnits += stock
          totalValue += stock * unitCost
        }
      })

    return { totalUnits, totalValue }
  }, [products, currentStockByProductId, bomCostBySku])

  async function handleSaveStockCount(e) {
    e.preventDefault()

    const adjustments = []
    const todayRef = `COUNT-${new Date().toISOString().slice(0, 10)}`

    activeProducts.forEach(p => {
      const rawInput = countedInputs[p.id]
      if (rawInput === undefined || rawInput === '') return

      const countedQty = Number(rawInput)
      if (Number.isNaN(countedQty) || countedQty < 0) return

      const currentQty = currentStockByProductId[p.id] || 0
      const diffQty = Number((countedQty - currentQty).toFixed(2))
      const unitCost = bomCostBySku[p.sku] || 0
      const customNote = (rowNotes[p.id] || '').trim()
      const combinedNote = [
        `นับจริง ${countedQty} ${p.unit} (เดิม ${currentQty})`,
        customNote,
        batchNote.trim()
      ]
        .filter(Boolean)
        .join(' | ')

      // บันทึกเฉพาะรายการที่มีการกรอก (แม้ยอดเท่าเดิมก็บันทึกไว้เป็นหลักฐานว่าตรวจนับแล้ว)
      adjustments.push({
        product_id: p.id,
        movement_type: 'ADJUST',
        quantity: diffQty,
        unit_cost: Number(unitCost.toFixed(2)),
        reference_no: todayRef,
        note: combinedNote
      })
    })

    if (adjustments.length === 0) {
      showToast('error', 'กรุณากรอก "ยอดที่นับได้จริง" อย่างน้อย 1 รายการก่อนบันทึกครับ')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.from('inventory_movements').insert(adjustments)
      if (error) throw error

      setCountedInputs({})
      setRowNotes({})
      setBatchNote('')
      await fetchAllData()
      showToast('success', `✅ บันทึกยอดตรวจนับสต็อกเรียบร้อยแล้ว (${adjustments.length} รายการ)`)
    } catch (err) {
      console.error('Error saving stock count:', err)
      showToast('error', `บันทึกไม่สำเร็จ: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  function formatNum(val, digits = 2) {
    return Number(val || 0).toLocaleString('th-TH', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    })
  }

  const productById = useMemo(() => {
    const map = {}
    products.forEach(p => {
      map[p.id] = p
    })
    return map
  }, [products])

  const cardStyle = {
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '18px',
    color: '#1e293b'
  }

  const thStyle = {
    padding: '9px 10px',
    border: '1px solid #cbd5e1',
    background: '#e2e8f0',
    color: '#0f172a',
    fontSize: '13px',
    fontWeight: 'bold'
  }

  const tdStyle = {
    padding: '8px 10px',
    border: '1px solid #e2e8f0',
    fontSize: '14px',
    color: '#1e293b'
  }

  return (
    <div style={{ color: '#1e293b' }}>
      {/* Header */}
      <div style={{ ...cardStyle, background: '#eff6ff', border: '1px solid #93c5fd' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, color: '#1e40af' }}>📊 ตรวจนับและอัปเดตสต็อกสินค้า</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#374151' }}>
              นับของจริงแล้วกรอกเฉพาะช่อง <b>&ldquo;ยอดที่นับได้จริง&rdquo;</b> ระบบจะปรับยอดและดึงต้นทุนจาก BOM ให้อัตโนมัติ
            </p>
          </div>

          <button
            type="button"
            onClick={fetchAllData}
            disabled={loading}
            style={{
              padding: '8px 14px',
              borderRadius: '6px',
              border: '1px solid #93c5fd',
              background: '#ffffff',
              color: '#1e40af',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            🔄 รีเฟรชยอดล่าสุด
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#166534' }}>สินค้าพร้อมขายคงเหลือรวม</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#14532d', marginTop: '4px' }}>
            {formatNum(stockSummary.totalUnits, 0)} <span style={{ fontSize: '14px', fontWeight: 'normal' }}>หน่วย</span>
          </div>
        </div>

        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#92400e' }}>มูลค่าสต็อกคงเหลือ (ตามต้นทุน BOM)</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#78350f', marginTop: '4px' }}>
            {formatNum(stockSummary.totalValue, 2)} <span style={{ fontSize: '14px', fontWeight: 'normal' }}>บาท</span>
          </div>
        </div>
      </div>

      {message && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontWeight: 'bold',
            background: message.type === 'error' ? '#fee2e2' : '#dcfce7',
            border: `1px solid ${message.type === 'error' ? '#fca5a5' : '#86efac'}`,
            color: message.type === 'error' ? '#991b1b' : '#166534'
          }}
        >
          {message.text}
        </div>
      )}

      {/* Stock Count Form */}
      <form onSubmit={handleSaveStockCount} style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 ค้นหา SKU หรือชื่อสินค้า..."
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              width: '260px',
              maxWidth: '100%'
            }}
          />

          <input
            type="text"
            value={batchNote}
            onChange={e => setBatchNote(e.target.value)}
            placeholder="หมายเหตุรอบนับนี้ (เช่น นับเช้าวันอังคาร / ชื่อผู้นับ)"
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              flex: '1 1 280px'
            }}
          />
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: '#64748b' }}>กำลังโหลดข้อมูลสต็อก...</p>
        ) : (
          <div style={{ overflowX: 'auto', marginBottom: '14px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>SKU</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>สินค้า</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>ต้นทุน BOM/หน่วย</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>ยอดในระบบเดิม</th>
                  <th style={{ ...thStyle, textAlign: 'center', background: '#dbeafe', width: '140px' }}>
                    ยอดที่นับได้จริง
                  </th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>ส่วนต่าง (+/-)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>มูลค่าคงเหลือ (บ.)</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>หมายเหตุ / ของเสีย</th>
                </tr>
              </thead>
              <tbody>
                {activeProducts.map(p => {
                  const currentQty = currentStockByProductId[p.id] || 0
                  const unitCost = bomCostBySku[p.sku] || 0
                  const rawVal = countedInputs[p.id]
                  const hasInput = rawVal !== undefined && rawVal !== ''
                  const countedQty = hasInput ? Number(rawVal) : currentQty
                  const diff = hasInput ? countedQty - currentQty : 0
                  const rowValue = countedQty * unitCost

                  return (
                    <tr key={p.id} style={{ background: hasInput ? '#f0f9ff' : '#ffffff' }}>
                      <td style={tdStyle}>{p.sku}</td>
                      <td style={{ ...tdStyle, fontWeight: 'bold' }}>
                        {p.name} <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#64748b' }}>({p.unit})</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: unitCost > 0 ? '#92400e' : '#94a3b8' }}>
                        {unitCost > 0 ? formatNum(unitCost, 2) : 'ยังไม่ผูก BOM'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>
                        {formatNum(currentQty, 0)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', background: '#eff6ff' }}>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={countedInputs[p.id] ?? ''}
                          onChange={e =>
                            setCountedInputs(prev => ({ ...prev, [p.id]: e.target.value }))
                          }
                          placeholder={String(currentQty)}
                          style={{
                            width: '90px',
                            padding: '6px 8px',
                            borderRadius: '5px',
                            border: '1px solid #60a5fa',
                            textAlign: 'right',
                            fontWeight: 'bold',
                            fontSize: '15px',
                            background: '#ffffff',
                            color: '#1e3a8a'
                          }}
                        />
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: 'right',
                          fontWeight: 'bold',
                          color: !hasInput || diff === 0 ? '#64748b' : diff > 0 ? '#15803d' : '#b91c1c'
                        }}
                      >
                        {!hasInput ? '-' : diff > 0 ? `+${formatNum(diff, 0)}` : formatNum(diff, 0)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>
                        {formatNum(rowValue, 2)}
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          value={rowNotes[p.id] ?? ''}
                          onChange={e =>
                            setRowNotes(prev => ({ ...prev, [p.id]: e.target.value }))
                          }
                          placeholder="เช่น เสีย 2 / ชิม 1"
                          style={{
                            width: '100%',
                            padding: '5px 8px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            fontSize: '13px',
                            boxSizing: 'border-box'
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            * รายการไหนที่ไม่ได้นับในรอบนี้ ปล่อยว่างไว้ ระบบจะไม่ไปเปลี่ยนยอดเดิมครับ
          </span>
          <button
            type="submit"
            disabled={saving}
            style={{
              background: '#1d4ed8',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 22px',
              fontWeight: 'bold',
              fontSize: '15px',
              cursor: 'pointer'
            }}
          >
            {saving ? 'กำลังบันทึก...' : '💾 บันทึกยอดตรวจนับสต็อก'}
          </button>
        </div>
      </form>

      {/* Recent Movements History */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, marginBottom: '10px' }}>🕒 ประวัติการปรับปรุงสต็อกล่าสุด</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left' }}>วัน-เวลา</th>
                <th style={{ ...thStyle, textAlign: 'left' }}>สินค้า</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>ประเภท</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>จำนวนที่ปรับ</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>ต้นทุน/หน่วย (บ.)</th>
                <th style={{ ...thStyle, textAlign: 'left' }}>รายละเอียด / หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '16px' }}>
                    ยังไม่มีประวัติการบันทึกสต็อกสินค้าครับ
                  </td>
                </tr>
              ) : (
                movements.slice(0, 20).map(m => {
                  const prod = productById[m.product_id]
                  const qty = Number(m.quantity) || 0
                  return (
                    <tr key={m.id}>
                      <td style={{ ...tdStyle, fontSize: '12px', color: '#475569' }}>
                        {m.created_at
                          ? new Date(m.created_at).toLocaleString('th-TH', {
                              dateStyle: 'short',
                              timeStyle: 'short'
                            })
                          : '-'}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 'bold' }}>
                        {prod ? `${prod.sku} — ${prod.name}` : '-'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontSize: '12px' }}>
                        {m.movement_type}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: 'right',
                          fontWeight: 'bold',
                          color: qty >= 0 ? '#15803d' : '#b91c1c'
                        }}
                      >
                        {qty > 0 ? `+${formatNum(qty, 0)}` : formatNum(qty, 0)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{formatNum(m.unit_cost, 2)}</td>
                      <td style={{ ...tdStyle, fontSize: '13px', color: '#334155' }}>{m.note || '-'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}