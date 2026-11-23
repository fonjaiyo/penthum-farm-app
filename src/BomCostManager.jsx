import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'

export default function BomCostManager() {
  const [subTab, setSubTab] = useState('bom') // 'bom' | 'materials'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const [products, setProducts] = useState([])
  const [materials, setMaterials] = useState([])
  const [accounts, setAccounts] = useState([])
  const [bomHeaders, setBomHeaders] = useState([])
  const [bomItems, setBomItems] = useState([])

  const [selectedSku, setSelectedSku] = useState('BEV-001')
  const [recipeName, setRecipeName] = useState('')
  const [batchYieldQty, setBatchYieldQty] = useState(1)
  const [bomNotes, setBomNotes] = useState('')
  const [editableItems, setEditableItems] = useState([])

  const [retailPrice, setRetailPrice] = useState('')
  const [wholesalePrice, setWholesalePrice] = useState('')

  const [newItemMaterialId, setNewItemMaterialId] = useState('')
  const [newItemUsageType, setNewItemUsageType] = useState('batch')
  const [newItemQty, setNewItemQty] = useState('')

  const [materialSearch, setMaterialSearch] = useState('')
  const [newMat, setNewMat] = useState({
    name: '',
    unit: 'กรัม',
    purchase_price: '',
    purchase_qty: '1000',
    account_code: '5101',
    notes: ''
  })
  const [editingMaterialId, setEditingMaterialId] = useState(null)
  const [editMatForm, setEditMatForm] = useState({})

  function showToast(type, text) {
    setMessage({ type, text })
  }

  async function fetchAllData() {
    setLoading(true)
    try {
      const [prodRes, matRes, accRes, hdrRes, itemRes] = await Promise.all([
        supabase.from('products').select('*').order('sku', { ascending: true }),
        supabase.from('materials').select('*').order('name', { ascending: true }),
        supabase
          .from('chart_of_accounts')
          .select('code, name_th, category')
          .order('sort_order', { ascending: true }),
        supabase.from('product_bom_headers').select('*').order('id', { ascending: true }),
        supabase
          .from('product_bom_items')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true })
      ])

      if (prodRes.error) throw prodRes.error
      if (matRes.error) throw matRes.error
      if (accRes.error) throw accRes.error
      if (hdrRes.error) throw hdrRes.error
      if (itemRes.error) throw itemRes.error

      const loadedProducts = prodRes.data || []
      setProducts(loadedProducts)
      setMaterials(matRes.data || [])
      setAccounts(accRes.data || [])
      setBomHeaders(hdrRes.data || [])
      setBomItems(itemRes.data || [])

      if (loadedProducts.length > 0 && !loadedProducts.some(p => p.sku === selectedSku)) {
        setSelectedSku(loadedProducts[0].sku)
      }
    } catch (err) {
      console.error('Error loading BOM data:', err)
      showToast('error', `โหลดข้อมูลไม่สำเร็จ: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAllData()
  }, [])

  useEffect(() => {
    const product = products.find(p => p.sku === selectedSku)
    if (product) {
      setRetailPrice(product.selling_price ?? '')
      setWholesalePrice(product.wholesale_price ?? '')
    } else {
      setRetailPrice('')
      setWholesalePrice('')
    }

    const header = bomHeaders.find(h => h.product_sku === selectedSku && h.is_active)
    if (header) {
      setRecipeName(header.recipe_name || '')
      setBatchYieldQty(Number(header.batch_yield_qty) || 1)
      setBomNotes(header.notes || '')

      const itemsForHeader = bomItems
        .filter(i => i.bom_id === header.id)
        .map(i => ({
          id: i.id,
          material_id: i.material_id,
          usage_type: i.usage_type,
          qty: Number(i.qty) || 0,
          notes: i.notes || '',
          sort_order: i.sort_order ?? 10
        }))
      setEditableItems(itemsForHeader)
    } else {
      setRecipeName(product ? `สูตรมาตรฐาน ${product.name}` : '')
      setBatchYieldQty(1)
      setBomNotes('')
      setEditableItems([])
    }
  }, [selectedSku, products, bomHeaders, bomItems])

  const materialMap = useMemo(() => {
    const map = {}
    materials.forEach(m => {
      map[m.id] = m
    })
    return map
  }, [materials])

  const costBreakdown = useMemo(() => {
    const yieldQty = Number(batchYieldQty) > 0 ? Number(batchYieldQty) : 1
    let totalPerUnit = 0
    let totalPerBatch = 0

    const rows = editableItems.map((item, idx) => {
      const mat = materialMap[item.material_id]
      const unitCost = mat ? Number(mat.unit_cost) || 0 : 0
      const qty = Number(item.qty) || 0

      const costPerUnit =
        item.usage_type === 'per_unit' ? qty * unitCost : (qty * unitCost) / yieldQty

      const costPerBatch =
        item.usage_type === 'per_unit' ? qty * unitCost * yieldQty : qty * unitCost

      totalPerUnit += costPerUnit
      totalPerBatch += costPerBatch

      return {
        ...item,
        index: idx,
        material: mat,
        unitCost,
        costPerUnit,
        costPerBatch
      }
    })

    const retail = Number(retailPrice) || 0
    const wholesale = Number(wholesalePrice) || 0

    const retailProfit = retail - totalPerUnit
    const retailMargin = retail > 0 ? (retailProfit / retail) * 100 : 0

    const wholesaleProfit = wholesale - totalPerUnit
    const wholesaleMargin = wholesale > 0 ? (wholesaleProfit / wholesale) * 100 : 0

    return {
      rows,
      totalPerUnit,
      totalPerBatch,
      retail,
      wholesale,
      retailProfit,
      retailMargin,
      wholesaleProfit,
      wholesaleMargin
    }
  }, [editableItems, materialMap, batchYieldQty, retailPrice, wholesalePrice])

  const allBomSummary = useMemo(() => {
    return bomHeaders
      .filter(h => h.is_active)
      .map(h => {
        const prod = products.find(p => p.sku === h.product_sku)
        const yieldQty = Number(h.batch_yield_qty) > 0 ? Number(h.batch_yield_qty) : 1
        const items = bomItems.filter(i => i.bom_id === h.id)

        const unitCost = items.reduce((sum, item) => {
          const mat = materialMap[item.material_id]
          const mCost = mat ? Number(mat.unit_cost) || 0 : 0
          const q = Number(item.qty) || 0
          return sum + (item.usage_type === 'per_unit' ? q * mCost : (q * mCost) / yieldQty)
        }, 0)

        const retail = Number(prod?.selling_price) || 0
        const wholesale = Number(prod?.wholesale_price) || 0

        return {
          sku: h.product_sku,
          name: prod?.name || h.product_sku,
          unit: prod?.unit || 'หน่วย',
          recipeName: h.recipe_name,
          yieldQty,
          unitCost,
          retail,
          retailProfit: retail - unitCost,
          retailMargin: retail > 0 ? ((retail - unitCost) / retail) * 100 : 0,
          wholesale,
          wholesaleProfit: wholesale > 0 ? wholesale - unitCost : null,
          wholesaleMargin: wholesale > 0 ? ((wholesale - unitCost) / wholesale) * 100 : null
        }
      })
  }, [bomHeaders, bomItems, products, materialMap])

  function handleAddBomItem() {
    if (!newItemMaterialId) {
      showToast('error', 'กรุณาเลือกวัตถุดิบหรือบรรจุภัณฑ์ก่อนครับ')
      return
    }
    const qtyNum = Number(newItemQty)
    if (!qtyNum || qtyNum <= 0) {
      showToast('error', 'กรุณาระบุปริมาณที่ใช้ให้มากกว่า 0 ครับ')
      return
    }

    setEditableItems(prev => [
      ...prev,
      {
        id: null,
        material_id: Number(newItemMaterialId),
        usage_type: newItemUsageType,
        qty: qtyNum,
        notes: '',
        sort_order: (prev.length + 1) * 10
      }
    ])

    setNewItemMaterialId('')
    setNewItemQty('')
  }

  function handleUpdateEditableItem(index, field, value) {
    setEditableItems(prev =>
      prev.map((item, idx) =>
        idx === index
          ? {
              ...item,
              [field]: field === 'qty' || field === 'material_id' ? Number(value) : value
            }
          : item
      )
    )
  }

  function handleRemoveEditableItem(index) {
    setEditableItems(prev => prev.filter((_, idx) => idx !== index))
  }

  async function handleSaveBomAndPrices() {
    if (!selectedSku) return
    if (!recipeName.trim()) {
      showToast('error', 'กรุณากรอกชื่อสูตรก่อนบันทึกครับ')
      return
    }
    if (Number(batchYieldQty) <= 0) {
      showToast('error', 'ผลผลิตต่อ 1 สูตร ต้องมากกว่า 0 ครับ')
      return
    }

    setSaving(true)
    try {
      const { error: prodErr } = await supabase
        .from('products')
        .update({
          selling_price: retailPrice === '' ? null : Number(retailPrice),
          wholesale_price: wholesalePrice === '' ? null : Number(wholesalePrice)
        })
        .eq('sku', selectedSku)

      if (prodErr) throw prodErr

      const existingHeader = bomHeaders.find(h => h.product_sku === selectedSku && h.is_active)
      let bomId = existingHeader?.id

      if (bomId) {
        const { error: hdrErr } = await supabase
          .from('product_bom_headers')
          .update({
            recipe_name: recipeName.trim(),
            batch_yield_qty: Number(batchYieldQty),
            notes: bomNotes.trim() || null
          })
          .eq('id', bomId)
        if (hdrErr) throw hdrErr
      } else {
        const { data: newHdr, error: insHdrErr } = await supabase
          .from('product_bom_headers')
          .insert({
            product_sku: selectedSku,
            recipe_name: recipeName.trim(),
            batch_yield_qty: Number(batchYieldQty),
            notes: bomNotes.trim() || null,
            is_active: true
          })
          .select('id')
          .single()
        if (insHdrErr) throw insHdrErr
        bomId = newHdr.id
      }

      const { error: delErr } = await supabase
        .from('product_bom_items')
        .delete()
        .eq('bom_id', bomId)
      if (delErr) throw delErr

      if (editableItems.length > 0) {
        const payload = editableItems.map((item, idx) => ({
          bom_id: bomId,
          material_id: Number(item.material_id),
          usage_type: item.usage_type,
          qty: Number(item.qty),
          notes: item.notes || null,
          sort_order: (idx + 1) * 10
        }))

        const { error: insItemsErr } = await supabase.from('product_bom_items').insert(payload)
        if (insItemsErr) throw insItemsErr
      }

      await fetchAllData()
      showToast('success', 'บันทึกสูตร BOM และราคาขายเรียบร้อยแล้วครับ')
    } catch (err) {
      console.error('Error saving BOM:', err)
      showToast('error', `บันทึกไม่สำเร็จ: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddMaterial(e) {
    e.preventDefault()
    if (!newMat.name.trim() || !newMat.unit.trim()) {
      showToast('error', 'กรุณากรอกชื่อวัตถุดิบและหน่วยใช้ในสูตรครับ')
      return
    }
    if (Number(newMat.purchase_qty) <= 0) {
      showToast('error', 'ปริมาณที่ซื้อต้องมากกว่า 0 ครับ')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.from('materials').insert({
        name: newMat.name.trim(),
        unit: newMat.unit.trim(),
        purchase_price: Number(newMat.purchase_price) || 0,
        purchase_qty: Number(newMat.purchase_qty) || 1,
        account_code: newMat.account_code || null,
        notes: newMat.notes.trim() || null,
        is_active: true
      })

      if (error) throw error

      setNewMat({
        name: '',
        unit: 'กรัม',
        purchase_price: '',
        purchase_qty: '1000',
        account_code: '5101',
        notes: ''
      })
      await fetchAllData()
      showToast('success', 'เพิ่มรายการวัตถุดิบ/บรรจุภัณฑ์เรียบร้อยครับ')
    } catch (err) {
      console.error('Error adding material:', err)
      showToast('error', `เพิ่มวัตถุดิบไม่สำเร็จ: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  function startEditMaterial(mat) {
    setEditingMaterialId(mat.id)
    setEditMatForm({
      name: mat.name,
      unit: mat.unit,
      purchase_price: mat.purchase_price,
      purchase_qty: mat.purchase_qty,
      account_code: mat.account_code || '',
      notes: mat.notes || ''
    })
  }

  async function handleSaveEditMaterial(id) {
    if (Number(editMatForm.purchase_qty) <= 0) {
      showToast('error', 'ปริมาณที่ซื้อต้องมากกว่า 0 ครับ')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase
        .from('materials')
        .update({
          name: editMatForm.name.trim(),
          unit: editMatForm.unit.trim(),
          purchase_price: Number(editMatForm.purchase_price) || 0,
          purchase_qty: Number(editMatForm.purchase_qty) || 1,
          account_code: editMatForm.account_code || null,
          notes: editMatForm.notes.trim() || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (error) throw error
      setEditingMaterialId(null)
      await fetchAllData()
      showToast('success', 'อัปเดตราคาวัตถุดิบเรียบร้อย (สูตร BOM คำนวณใหม่ให้อัตโนมัติแล้ว)')
    } catch (err) {
      console.error('Error updating material:', err)
      showToast('error', `แก้ไขไม่สำเร็จ: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const filteredMaterials = useMemo(() => {
    const q = materialSearch.trim().toLowerCase()
    if (!q) return materials
    return materials.filter(
      m =>
        m.name.toLowerCase().includes(q) ||
        (m.notes && m.notes.toLowerCase().includes(q)) ||
        (m.account_code && m.account_code.includes(q))
    )
  }, [materials, materialSearch])

  const selectedProduct = products.find(p => p.sku === selectedSku)

  function formatNum(val, digits = 2) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return '-'
    return Number(val).toLocaleString('th-TH', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    })
  }

  const inputStyle = {
    padding: '8px 10px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#1e293b',
    fontSize: '14px',
    boxSizing: 'border-box'
  }

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
      <div style={{ ...cardStyle, border: '1px solid #86efac', background: '#f0fdf4' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, color: '#166534' }}>📐 จัดการสูตร BOM • ต้นทุนผลิต • ราคาขาย</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#374151' }}>
              คำนวณต้นทุนต่อหน่วยจากสูตรผลิตจริง พร้อมเทียบกำไรราคาปลีกและราคาส่ง
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setSubTab('bom')}
              style={{
                padding: '8px 14px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 'bold',
                background: subTab === 'bom' ? '#15803d' : '#e5e7eb',
                color: subTab === 'bom' ? '#ffffff' : '#1f2937'
              }}
            >
              สูตร BOM & ราคาขาย
            </button>
            <button
              type="button"
              onClick={() => setSubTab('materials')}
              style={{
                padding: '8px 14px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 'bold',
                background: subTab === 'materials' ? '#15803d' : '#e5e7eb',
                color: subTab === 'materials' ? '#ffffff' : '#1f2937'
              }}
            >
              วัตถุดิบ & ราคาซื้อ ({materials.length})
            </button>
            <button
              type="button"
              onClick={fetchAllData}
              disabled={loading}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                cursor: 'pointer',
                background: '#ffffff',
                color: '#1f2937',
                fontWeight: 'bold'
              }}
            >
              🔄 รีเฟรช
            </button>
          </div>
        </div>
      </div>

      {/* Toast Message */}
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

      {loading ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: '28px', color: '#64748b' }}>
          กำลังโหลดข้อมูลสูตรและต้นทุน...
        </div>
      ) : subTab === 'bom' ? (
        <>
          {/* Section 1: Product & Recipe Header */}
          <div style={cardStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '4px' }}>
                  เลือกสินค้า (Product SKU)
                </label>
                <select
                  value={selectedSku}
                  onChange={e => setSelectedSku(e.target.value)}
                  style={{ ...inputStyle, width: '100%', fontWeight: 'bold' }}
                >
                  {products.map(p => (
                    <option key={p.sku} value={p.sku}>
                      {p.sku} — {p.name} ({p.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '4px' }}>
                  ชื่อสูตรการผลิต
                </label>
                <input
                  type="text"
                  value={recipeName}
                  onChange={e => setRecipeName(e.target.value)}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '4px' }}>
                  1 สูตร ได้กี่{selectedProduct?.unit || 'หน่วย'} (Yield)
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={batchYieldQty}
                  onChange={e => setBatchYieldQty(e.target.value)}
                  style={{ ...inputStyle, width: '100%', textAlign: 'right', fontWeight: 'bold', background: '#f0fdf4' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                หมายเหตุสูตร
              </label>
              <input
                type="text"
                value={bomNotes}
                onChange={e => setBomNotes(e.target.value)}
                placeholder="บันทึกวิธีทำหรือข้อสังเกตเพิ่มเติม..."
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>
          </div>

          {/* Section 2: Cost & Pricing Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginBottom: '18px' }}>
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#92400e' }}>
                ต้นทุนรวมต่อ 1 {selectedProduct?.unit || 'หน่วย'}
              </div>
              <div style={{ fontSize: '26px', fontWeight: 'bold', color: '#78350f', margin: '6px 0' }}>
                {formatNum(costBreakdown.totalPerUnit, 2)} บาท
              </div>
              <div style={{ fontSize: '12px', color: '#92400e', borderTop: '1px solid #fde68a', paddingTop: '6px' }}>
                ต้นทุนรวมทั้งสูตร ({batchYieldQty} {selectedProduct?.unit || 'หน่วย'}):{' '}
                <b>{formatNum(costBreakdown.totalPerBatch, 2)} บาท</b>
              </div>
            </div>

            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#166534' }}>ราคาขายปลีก (บาท)</span>
                <input
                  type="number"
                  step="any"
                  value={retailPrice}
                  onChange={e => setRetailPrice(e.target.value)}
                  style={{ ...inputStyle, width: '105px', textAlign: 'right', fontWeight: 'bold' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #bbf7d0', paddingTop: '8px' }}>
                <span style={{ fontSize: '12px', color: '#15803d' }}>กำไรปลีก:</span>
                <span style={{ fontWeight: 'bold', color: costBreakdown.retailProfit >= 0 ? '#166534' : '#b91c1c' }}>
                  {formatNum(costBreakdown.retailProfit, 2)} บ. ({formatNum(costBreakdown.retailMargin, 1)}%)
                </span>
              </div>
            </div>

            <div style={{ background: '#f0f9ff', border: '1px solid #7dd3fc', borderRadius: '8px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#0369a1' }}>ราคาขายส่ง (บาท)</span>
                <input
                  type="number"
                  step="any"
                  value={wholesalePrice}
                  onChange={e => setWholesalePrice(e.target.value)}
                  placeholder="ไม่บังคับ"
                  style={{ ...inputStyle, width: '105px', textAlign: 'right', fontWeight: 'bold' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #bae6fd', paddingTop: '8px' }}>
                <span style={{ fontSize: '12px', color: '#0284c7' }}>กำไรส่ง:</span>
                {wholesalePrice !== '' && Number(wholesalePrice) > 0 ? (
                  <span style={{ fontWeight: 'bold', color: costBreakdown.wholesaleProfit >= 0 ? '#0369a1' : '#b91c1c' }}>
                    {formatNum(costBreakdown.wholesaleProfit, 2)} บ. ({formatNum(costBreakdown.wholesaleMargin, 1)}%)
                  </span>
                ) : (
                  <span style={{ fontSize: '12px', color: '#64748b' }}>ยังไม่ระบุราคาส่ง</span>
                )}
              </div>
            </div>
          </div>

          {/* Section 3: BOM Items Table */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
              <h3 style={{ margin: 0 }}>
                รายการส่วนผสมและบรรจุภัณฑ์ในสูตร ({costBreakdown.rows.length} รายการ)
              </h3>
              <span style={{ fontSize: '12px', color: '#475569' }}>
                * &ldquo;ต่อ 1 สูตร&rdquo; ระบบจะหาร {batchYieldQty} ให้อัตโนมัติ | &ldquo;ต่อ 1{' '}
                {selectedProduct?.unit || 'หน่วย'}&rdquo; คิดเต็มหน่วย
              </span>
            </div>

            <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: '45px', textAlign: 'center' }}>#</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>วัตถุดิบ / บรรจุภัณฑ์</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>วิธีคิดสัดส่วน</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>ปริมาณที่ใช้</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>ต้นทุน/หน่วยย่อย</th>
                    <th style={{ ...thStyle, textAlign: 'right', background: '#fef3c7' }}>
                      ต้นทุนต่อ 1 {selectedProduct?.unit || 'หน่วย'} (บ.)
                    </th>
                    <th style={{ ...thStyle, width: '55px', textAlign: 'center' }}>ลบ</th>
                  </tr>
                </thead>
                <tbody>
                  {costBreakdown.rows.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '18px' }}>
                        ยังไม่มีรายการส่วนผสมในสูตรนี้ เพิ่มรายการได้จากแถบด้านล่างครับ
                      </td>
                    </tr>
                  ) : (
                    costBreakdown.rows.map(row => (
                      <tr key={row.index}>
                        <td style={{ ...tdStyle, textAlign: 'center', color: '#64748b' }}>{row.index + 1}</td>
                        <td style={tdStyle}>
                          <select
                            value={row.material_id}
                            onChange={e => handleUpdateEditableItem(row.index, 'material_id', e.target.value)}
                            style={{ ...inputStyle, width: '100%' }}
                          >
                            {materials.map(m => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.unit})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <select
                            value={row.usage_type}
                            onChange={e => handleUpdateEditableItem(row.index, 'usage_type', e.target.value)}
                            style={{
                              ...inputStyle,
                              fontSize: '12px',
                              fontWeight: 'bold',
                              background: row.usage_type === 'batch' ? '#eff6ff' : '#faf5ff'
                            }}
                          >
                            <option value="batch">ต่อ 1 สูตร (หาร {batchYieldQty})</option>
                            <option value="per_unit">ต่อ 1 {selectedProduct?.unit || 'หน่วย'}</option>
                          </select>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <input
                              type="number"
                              step="any"
                              value={row.qty}
                              onChange={e => handleUpdateEditableItem(row.index, 'qty', e.target.value)}
                              style={{ ...inputStyle, width: '85px', textAlign: 'right', fontWeight: 'bold' }}
                            />
                            <span style={{ fontSize: '12px', color: '#475569' }}>{row.material?.unit || ''}</span>
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontSize: '12px', color: '#475569' }}>
                          {formatNum(row.unitCost, 4)} บ./{row.material?.unit || 'หน่วย'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', background: '#fffbeb' }}>
                          {formatNum(row.costPerUnit, 2)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveEditableItem(row.index)}
                            style={{
                              background: '#fee2e2',
                              color: '#b91c1c',
                              border: '1px solid #fca5a5',
                              borderRadius: '4px',
                              padding: '4px 8px',
                              cursor: 'pointer',
                              fontWeight: 'bold'
                            }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#fef3c7', fontWeight: 'bold' }}>
                    <td colSpan="5" style={{ ...tdStyle, textAlign: 'right' }}>
                      รวมต้นทุนต่อ 1 {selectedProduct?.unit || 'หน่วย'}:
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontSize: '15px' }}>
                      {formatNum(costBreakdown.totalPerUnit, 2)} บ.
                    </td>
                    <td style={tdStyle} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Add new item row */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', background: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '12px' }}>
              <select
                value={newItemMaterialId}
                onChange={e => setNewItemMaterialId(e.target.value)}
                style={{ ...inputStyle, flex: '2 1 220px' }}
              >
                <option value="">-- เลือกวัตถุดิบ / บรรจุภัณฑ์ที่ต้องการเพิ่ม --</option>
                {materials.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} (หน่วย: {m.unit} | ต้นทุน {formatNum(m.unit_cost, 4)} บ./{m.unit})
                  </option>
                ))}
              </select>

              <select
                value={newItemUsageType}
                onChange={e => setNewItemUsageType(e.target.value)}
                style={{ ...inputStyle, flex: '1 1 160px' }}
              >
                <option value="batch">ต่อ 1 สูตร (หาร {batchYieldQty})</option>
                <option value="per_unit">ต่อ 1 {selectedProduct?.unit || 'หน่วย'}</option>
              </select>

              <input
                type="number"
                step="any"
                value={newItemQty}
                onChange={e => setNewItemQty(e.target.value)}
                placeholder="ปริมาณที่ใช้"
                style={{ ...inputStyle, width: '120px', textAlign: 'right' }}
              />

              <button
                type="button"
                onClick={handleAddBomItem}
                style={{
                  background: '#dcfce7',
                  color: '#166534',
                  border: '1px solid #86efac',
                  borderRadius: '6px',
                  padding: '8px 14px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                + เพิ่มในสูตร
              </button>
            </div>

            {/* Save Button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                กดบันทึกเพื่ออัปเดตทั้งสูตรส่วนผสมและราคาปลีก/ราคาส่งของสินค้านี้พร้อมกัน
              </span>
              <button
                type="button"
                onClick={handleSaveBomAndPrices}
                disabled={saving}
                style={{
                  background: '#15803d',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '15px'
                }}
              >
                {saving ? 'กำลังบันทึก...' : '💾 บันทึกสูตร BOM และราคาขาย'}
              </button>
            </div>
          </div>

          {/* Section 4: All Products Summary */}
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: '10px' }}>
              📊 สรุปต้นทุนและกำไรสินค้าที่มีสูตร BOM ({allBomSummary.length} รายการ)
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>SKU</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>สินค้า</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>ต้นทุน/หน่วย</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>ราคาปลีก</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>กำไรปลีก (%)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>ราคาส่ง</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>กำไรส่ง (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {allBomSummary.map(row => (
                    <tr
                      key={row.sku}
                      onClick={() => setSelectedSku(row.sku)}
                      style={{
                        cursor: 'pointer',
                        background: row.sku === selectedSku ? '#f0fdf4' : '#ffffff',
                        fontWeight: row.sku === selectedSku ? 'bold' : 'normal'
                      }}
                    >
                      <td style={tdStyle}>{row.sku}</td>
                      <td style={tdStyle}>
                        {row.name} <span style={{ fontSize: '12px', color: '#64748b' }}>({row.yieldQty} {row.unit}/สูตร)</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', color: '#92400e' }}>
                        {formatNum(row.unitCost, 2)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{formatNum(row.retail, 2)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: '#166534' }}>
                        {formatNum(row.retailProfit, 2)} ({formatNum(row.retailMargin, 1)}%)
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {row.wholesale > 0 ? formatNum(row.wholesale, 2) : '-'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: '#0369a1' }}>
                        {row.wholesale > 0
                          ? `${formatNum(row.wholesaleProfit, 2)} (${formatNum(row.wholesaleMargin, 1)}%)`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Tab 2: Materials Master */
        <div>
          <form onSubmit={handleAddMaterial} style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>+ เพิ่มวัตถุดิบ / บรรจุภัณฑ์ใหม่</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>ชื่อรายการ *</label>
                <input
                  type="text"
                  required
                  value={newMat.name}
                  onChange={e => setNewMat({ ...newMat, name: e.target.value })}
                  placeholder="เช่น มะนาว, ถุงซิปล็อก"
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>หน่วยใช้ในสูตร *</label>
                <input
                  type="text"
                  required
                  value={newMat.unit}
                  onChange={e => setNewMat({ ...newMat, unit: e.target.value })}
                  placeholder="กรัม / cc / ใบ"
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>ราคาซื้อล่าสุด (บาท) *</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={newMat.purchase_price}
                  onChange={e => setNewMat({ ...newMat, purchase_price: e.target.value })}
                  placeholder="เช่น 100"
                  style={{ ...inputStyle, width: '100%', textAlign: 'right' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>ปริมาณที่ได้ *</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={newMat.purchase_qty}
                  onChange={e => setNewMat({ ...newMat, purchase_qty: e.target.value })}
                  placeholder="เช่น 1000"
                  style={{ ...inputStyle, width: '100%', textAlign: 'right' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>รหัสบัญชี</label>
                <select
                  value={newMat.account_code}
                  onChange={e => setNewMat({ ...newMat, account_code: e.target.value })}
                  style={{ ...inputStyle, width: '100%' }}
                >
                  <option value="">-- ไม่ระบุ --</option>
                  {accounts.map(a => (
                    <option key={a.code} value={a.code}>
                      {a.code} ({a.category})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={newMat.notes}
                onChange={e => setNewMat({ ...newMat, notes: e.target.value })}
                placeholder="หมายเหตุเพิ่มเติม..."
                style={{ ...inputStyle, flex: '1 1 240px' }}
              />
              <button
                type="submit"
                disabled={saving}
                style={{
                  background: '#15803d',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 18px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                บันทึกวัตถุดิบใหม่
              </button>
            </div>
          </form>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
              <h3 style={{ margin: 0 }}>ทะเบียนวัตถุดิบและบรรจุภัณฑ์ทั้งหมด</h3>
              <input
                type="text"
                value={materialSearch}
                onChange={e => setMaterialSearch(e.target.value)}
                placeholder="🔍 ค้นหาชื่อวัตถุดิบ / รหัสบัญชี..."
                style={{ ...inputStyle, width: '250px' }}
              />
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>ชื่อรายการ</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>หน่วย</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>ราคาซื้อ (บ.)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>ปริมาณซื้อ</th>
                    <th style={{ ...thStyle, textAlign: 'right', background: '#fef3c7' }}>ต้นทุน/หน่วยย่อย</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>บัญชี</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMaterials.map(mat => {
                    const isEditing = editingMaterialId === mat.id
                    return (
                      <tr key={mat.id}>
                        <td style={tdStyle}>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editMatForm.name}
                              onChange={e => setEditMatForm({ ...editMatForm, name: e.target.value })}
                              style={{ ...inputStyle, width: '100%' }}
                            />
                          ) : (
                            <div>
                              <div style={{ fontWeight: 'bold' }}>{mat.name}</div>
                              {mat.notes && <div style={{ fontSize: '12px', color: '#64748b' }}>{mat.notes}</div>}
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editMatForm.unit}
                              onChange={e => setEditMatForm({ ...editMatForm, unit: e.target.value })}
                              style={{ ...inputStyle, width: '65px', textAlign: 'center' }}
                            />
                          ) : (
                            mat.unit
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {isEditing ? (
                            <input
                              type="number"
                              step="any"
                              value={editMatForm.purchase_price}
                              onChange={e => setEditMatForm({ ...editMatForm, purchase_price: e.target.value })}
                              style={{ ...inputStyle, width: '90px', textAlign: 'right' }}
                            />
                          ) : (
                            formatNum(mat.purchase_price, 2)
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {isEditing ? (
                            <input
                              type="number"
                              step="any"
                              value={editMatForm.purchase_qty}
                              onChange={e => setEditMatForm({ ...editMatForm, purchase_qty: e.target.value })}
                              style={{ ...inputStyle, width: '90px', textAlign: 'right' }}
                            />
                          ) : (
                            formatNum(mat.purchase_qty, 0)
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', background: '#fffbeb' }}>
                          {formatNum(
                            isEditing
                              ? Number(editMatForm.purchase_qty) > 0
                                ? Number(editMatForm.purchase_price) / Number(editMatForm.purchase_qty)
                                : 0
                              : mat.unit_cost,
                            4
                          )}{' '}
                          <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#64748b' }}>/{mat.unit}</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center', fontSize: '12px' }}>
                          {isEditing ? (
                            <select
                              value={editMatForm.account_code}
                              onChange={e => setEditMatForm({ ...editMatForm, account_code: e.target.value })}
                              style={inputStyle}
                            >
                              <option value="">-</option>
                              {accounts.map(a => (
                                <option key={a.code} value={a.code}>
                                  {a.code}
                                </option>
                              ))}
                            </select>
                          ) : (
                            mat.account_code || '-'
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {isEditing ? (
                            <div style={{ display: 'inline-flex', gap: '4px' }}>
                              <button
                                type="button"
                                onClick={() => handleSaveEditMaterial(mat.id)}
                                style={{
                                  background: '#15803d',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '4px',
                                  padding: '5px 8px',
                                  cursor: 'pointer',
                                  fontWeight: 'bold',
                                  fontSize: '12px'
                                }}
                              >
                                บันทึก
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingMaterialId(null)}
                                style={{
                                  background: '#e5e7eb',
                                  color: '#1f2937',
                                  border: 'none',
                                  borderRadius: '4px',
                                  padding: '5px 8px',
                                  cursor: 'pointer',
                                  fontSize: '12px'
                                }}
                              >
                                ยกเลิก
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditMaterial(mat)}
                              style={{
                                background: '#ffffff',
                                color: '#1f2937',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                padding: '5px 10px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 'bold'
                              }}
                            >
                              แก้ไขราคา
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}