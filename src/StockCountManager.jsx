import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'

export default function StockCountManager() {
  const [products, setProducts] = useState([])
  const [bomCosts, setBomCosts] = useState([])
  const [movements, setMovements] = useState([])
  const [orderItems, setOrderItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

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
      const [prodRes, costRes, movRes, ordRes] = await Promise.all([
        supabase.from('products').select('*').order('sku', { ascending: true }),
        supabase.from('v_product_bom_cost_summary').select('sku, total_cost_per_unit'),
        supabase
          .from('inventory_movements')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(300),
        supabase
          .from('order_items')
          .select(`
            id,
            order_id,
            product_sku,
            quantity,
            orders!inner (
              id,
              order_date,
              status,
              is_cancelled
            )
          `)
          .eq('orders.is_cancelled', false)
          .order('id', { ascending: false })
          .limit(1000)
      ])

      if (prodRes.error) throw prodRes.error
      if (costRes.error) throw costRes.error
      if (movRes.error) throw movRes.error
      if (ordRes.error) throw ordRes.error

      setProducts(prodRes.data || [])
      setBomCosts(costRes.data || [])
      setMovements(movRes.data || [])
      setOrderItems(ordRes.data || [])
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

  const bomCostBySku = useMemo(() => {
    const map = {}
    bomCosts.forEach(c => {
      map[c.sku] = Number(c.total_cost_per_unit) || 0
    })
    return map
  }, [bomCosts])

  // หา "การตรวจนับครั้งล่าสุด" ของแต่ละสินค้า และ "ยอดคงเหลือปัจจุบัน"
  const stockStateByProductId = useMemo(() => {
    const sortedAsc = [...movements].sort(
      (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
    )

    const lastCountInfo = {} // { [productId]: { qty, at } }
    const runningStock = {} // { [productId]: number }

    sortedAsc.forEach(m => {
      if (!m.product_id) return
      const qty = Number(m.quantity) || 0
      if (runningStock[m.product_id] === undefined) runningStock[m.product_id] = 0

      if (m.movement_type === 'IN') {
        runningStock[m.product_id] += qty
      } else if (m.movement_type === 'OUT') {
        runningStock[m.product_id] -= qty
      } else if (m.movement_type === 'ADJUST') {
        runningStock[m.product_id] += qty
        if (m.reference_no && String(m.reference_no).startsWith('COUNT-')) {
          lastCountInfo[m.product_id] = {
            qty: runningStock[m.product_id],
            at: m.created_at
          }
        }
      }
    })

    return { lastCountInfo, runningStock }
  }, [movements])

  // คำนวณยอดขายต่อ SKU เฉพาะช่วงเวลาหลังการนับครั้งก่อนจนถึงปัจจุบัน
  const periodSalesBySku = useMemo(() => {
    const skuToProduct = {}
    products.forEach(p => {
      skuToProduct[p.sku] = p
    })

    const salesMap = {}
    orderItems.forEach(item => {
      const sku = item.product_sku
      if (!sku) return
      const prod = skuToProduct[sku]
      const orderDateStr = item.orders?.order_date
      const statusStr = String(item.orders?.status || '').toLowerCase()

      if (statusStr.includes('cancel')) return

      const lastCount = prod ? stockStateByProductId.lastCountInfo[prod.id] : null
      if (lastCount && lastCount.at && orderDateStr) {
        const orderTime = new Date(orderDateStr).getTime()
        const countTime = new Date(lastCount.at).getTime()
        if (!Number.isNaN(orderTime) && !Number.isNaN(countTime) && orderTime <= countTime) {
          return
        }
      }

      salesMap[sku] = (salesMap[sku] || 0) + (Number(item.quantity) || 0)
    })

    return salesMap
  }, [orderItems, products, stockStateByProductId])

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

  const stockSummary = useMemo(() => {
    let totalUnits = 0
    let totalValue = 0

    products
      .filter(p => p.is_active !== false)
      .forEach(p => {
        const stock = stockStateByProductId.runningStock[p.id] || 0
        const unitCost = bomCostBySku[p.sku] || 0
        if (stock > 0) {
          totalUnits += stock
          totalValue += stock * unitCost
        }
      })

    return { totalUnits, totalValue }
  }, [products, stockStateByProductId, bomCostBySku])

  async function handleSaveStockCount(e) {
    e.preventDefault()

    const adjustments = []
    const todayRef = `COUNT-${new Date().toISOString().slice(0, 10)}`

    activeProducts.forEach(p => {
      const rawInput = countedInputs[p.id]
      if (rawInput === undefined || rawInput === '') return

      const countedQty = Number(rawInput)
      if (Number.isNaN(countedQty) || countedQty < 0) return

      const currentQty = stockStateByProductId.runningStock[p.id] || 0
      const soldBetween = periodSalesBySku[p.sku] || 0
      const expectedQty = currentQty - soldBetween
      const varianceQty = Number((countedQty - expectedQty).toFixed(2))
      const adjustmentToStock = Number((countedQty - currentQty).toFixed(2))

      const unitCost = bomCostBySku[p.sku] || 0
      const customNote = (rowNotes[p.id] || '').trim()
      const combinedNote = [
        `นับจริง ${countedQty} (ควรเหลือ ${expectedQty}, ขายรอบนี้ ${soldBetween})`,
        varianceQty !== 0 ? `ส่วนต่างนับ ${varianceQty > 0 ? `+${varianceQty}` : varianceQty}` : 'ยอดตรง',
        customNote,
        batchNote.trim()
      ]
        .filter(Boolean)
        .join(' | ')

      adjustments.push({
        product_id: p.id,
        movement_type: 'ADJUST',
        quantity: adjustmentToStock,
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
    padding: '9px 8px',
    border: '1px solid #cbd5e1',
    background: '#e2e8f0',
    color: '#0f172a',
    fontSize: '12px',
    fontWeight: 'bold'
  }

  const tdStyle = {
    padding: '8px 8px',
    border: '1px solid #e2e8f0',
    fontSize: '13px',
    color: '#1e293b'
  }

  const lightInputStyle = {
    padding: '7px 10px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#1e293b',
    fontSize: '13px',
    boxSizing: 'border-box'
  }

  return (
    <div style={{ color: '#1e293b' }}>
      {/* Header */}
      <div style={{ ...cardStyle, background: '#eff6ff', border: '1px solid #93c5fd' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, color: '#1e40af' }}>📊 ตรวจนับและอัปเดตสต็อกสินค้า</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#374151' }}>
              เทียบยอดนับครั้งก่อนกับยอดขายในระบบให้อัตโนมัติ เพื่อหา <b>&ldquo;ยอดที่ควรเหลือ&rdquo;</b> และ <b>&ldquo;ส่วนต่างที่หาย/เกินจริง&rdquo;</b>
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
            style={{ ...lightInputStyle, width: '250px', maxWidth: '100%' }}
          />

          <input
            type="text"
            value={batchNote}
            onChange={e => setBatchNote(e.target.value)}
            placeholder="หมายเหตุรอบนับนี้ (เช่น นับเช้าวันอังคาร / ชื่อผู้นับ)"
            style={{ ...lightInputStyle, flex: '1 1 280px' }}
          />
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: '#64748b' }}>กำลังโหลดข้อมูลสต็อกและยอดขาย...</p>
        ) : (
          <div style={{ overflowX: 'auto', marginBottom: '14px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>SKU</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>สินค้า</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>ต้นทุน BOM</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>ยอดเดิม</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>ขายรอบนี้</th>
                  <th style={{ ...thStyle, textAlign: 'right', background: '#fef9c3' }}>ควรเหลือ</th>
                  <th style={{ ...thStyle, textAlign: 'center', background: '#dbeafe', width: '115px' }}>นับได้จริง</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>ส่วนต่างจริง</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>มูลค่าคงเหลือ</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>หมายเหตุ / ของเสีย</th>
                </tr>
              </thead>
              <tbody>
                {activeProducts.map(p => {
                  const currentQty = stockStateByProductId.runningStock[p.id] || 0
                  const soldQty = periodSalesBySku[p.sku] || 0
                  const expectedQty = currentQty - soldQty
                  const unitCost = bomCostBySku[p.sku] || 0

                  const rawVal = countedInputs[p.id]
                  const hasInput = rawVal !== undefined && rawVal !== ''
                  const countedQty = hasInput ? Number(rawVal) : currentQty
                  const varianceQty = hasInput ? countedQty - expectedQty : 0
                  const rowValue = countedQty * unitCost

                  return (
                    <tr key={p.id} style={{ background: hasInput ? '#f0f9ff' : '#ffffff' }}>
                      <td style={tdStyle}>{p.sku}</td>
                      <td style={{ ...tdStyle, fontWeight: 'bold' }}>
                        {p.name} <span style={{ fontSize: '11px', fontWeight: 'normal', color: '#64748b' }}>({p.unit})</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: unitCost > 0 ? '#92400e' : '#94a3b8' }}>
                        {unitCost > 0 ? formatNum(unitCost, 2) : '-'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>
                        {formatNum(currentQty, 0)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: soldQty > 0 ? '#0369a1' : '#64748b' }}>
                        {soldQty > 0 ? `-${formatNum(soldQty, 0)}` : '0'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', background: '#fefce8' }}>
                        {formatNum(expectedQty, 0)}
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
                          placeholder={String(expectedQty)}
                          style={{
                            width: '80px',
                            padding: '5px 7px',
                            borderRadius: '5px',
                            border: '1px solid #60a5fa',
                            textAlign: 'right',
                            fontWeight: 'bold',
                            fontSize: '14px',
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
                          color: !hasInput || varianceQty === 0 ? '#64748b' : varianceQty > 0 ? '#15803d' : '#b91c1c'
                        }}
                      >
                        {!hasInput
                          ? '-'
                          : varianceQty > 0
                          ? `+${formatNum(varianceQty, 0)}`
                          : formatNum(varianceQty, 0)}
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
                          placeholder="เช่น หาย 1 / เสีย / ชิม"
                          style={{ ...lightInputStyle, width: '100%', padding: '5px 7px' }}
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
            * ส่วนต่างจริง = ยอดนับได้จริง − ยอดที่ควรเหลือ (ยอดเดิม − ยอดขายในระบบหลังนับครั้งก่อน)
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
                <th style={{ ...thStyle, textAlign: 'right' }}>ปรับสต็อก</th>
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