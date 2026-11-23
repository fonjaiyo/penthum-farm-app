import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'

const CATEGORY_LABELS = {
  LAND: 'ที่ดิน',
  BUILDING: 'อาคาร / โรงเรือน',
  TOURISM: 'ลานกางเต็นท์ / โฮมสเตย์',
  VEHICLE: 'ยานพาหนะ',
  EQUIPMENT: 'เครื่องมือ / อุปกรณ์'
}

const STATUS_LABELS = {
  ACTIVE: '🟢 ใช้งานปกติ',
  MAINTENANCE: '🟡 ซ่อมบำรุง / ปรับปรุง',
  INACTIVE: '🔴 ไม่ใช้งาน / ปลดระวาง'
}

const LOG_TYPE_LABELS = {
  MAINTENANCE: 'ซ่อมบำรุง',
  TAX_INSURANCE: 'ต่อภาษี / พ.ร.บ. / ประกัน',
  UPGRADE: 'ต่อเติม / ปรับปรุง',
  INSPECTION: 'ตรวจเช็กสภาพ'
}

const EMPTY_ASSET_FORM = {
  id: null,
  asset_code: '',
  name: '',
  category: 'BUILDING',
  location_zone: '',
  acquired_date: '',
  initial_cost: '',
  useful_life_years: '10',
  salvage_value: '0',
  is_depreciable: true,
  status: 'ACTIVE',
  plate_or_doc_ref: '',
  note: ''
}

export default function FixedAssetsManager() {
  const [subTab, setSubTab] = useState('assets') // 'assets' | 'maintenance'
  const [assets, setAssets] = useState([])
  const [maintenanceLogs, setMaintenanceLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  // Asset form & filters
  const [assetForm, setAssetForm] = useState(EMPTY_ASSET_FORM)
  const [isEditingAsset, setIsEditingAsset] = useState(false)
  const [searchAsset, setSearchAsset] = useState('')
  const [filterCategory, setFilterCategory] = useState('ALL')
  const [filterStatus, setFilterStatus] = useState('ALL')

  // Maintenance form & filter
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [logForm, setLogForm] = useState({
    log_date: new Date().toISOString().slice(0, 10),
    log_type: 'MAINTENANCE',
    amount: '',
    reference_no: '',
    note: ''
  })
  const [filterLogAssetId, setFilterLogAssetId] = useState('ALL')

  function showToast(type, text) {
    setMessage({ type, text })
  }

  async function fetchAllData() {
    setLoading(true)
    try {
      const [assetRes, logRes] = await Promise.all([
        supabase
          .from('fixed_assets')
          .select('*')
          .order('category', { ascending: true })
          .order('asset_code', { ascending: true }),
        supabase
          .from('asset_maintenance_logs')
          .select('*')
          .order('log_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(300)
      ])

      if (assetRes.error) throw assetRes.error
      if (logRes.error) throw logRes.error

      const loadedAssets = assetRes.data || []
      setAssets(loadedAssets)
      setMaintenanceLogs(logRes.data || [])

      if (loadedAssets.length > 0 && !selectedAssetId) {
        setSelectedAssetId(loadedAssets[0].id)
      }
    } catch (err) {
      console.error('Error loading fixed assets:', err)
      showToast('error', `โหลดข้อมูลสินทรัพย์ไม่สำเร็จ: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAllData()
  }, [])

  // Straight-line depreciation helper
  function calcAssetValuation(asset) {
    const initialCost = Number(asset.initial_cost) || 0
    const salvageValue = Math.max(0, Math.min(Number(asset.salvage_value) || 0, initialCost))
    const lifeYears = Number(asset.useful_life_years) || 0

    if (!asset.is_depreciable || asset.category === 'LAND' || lifeYears <= 0 || !asset.acquired_date) {
      return {
        initialCost,
        accumulatedDep: 0,
        bookValue: initialCost
      }
    }

    const startMs = new Date(asset.acquired_date).getTime()
    const nowMs = Date.now()
    if (Number.isNaN(startMs) || nowMs <= startMs) {
      return {
        initialCost,
        accumulatedDep: 0,
        bookValue: initialCost
      }
    }

    const elapsedYears = (nowMs - startMs) / (1000 * 60 * 60 * 24 * 365.25)
    const depreciableAmount = Math.max(0, initialCost - salvageValue)
    const annualDep = depreciableAmount / lifeYears
    const accumulatedDep = Math.min(depreciableAmount, Math.max(0, annualDep * elapsedYears))
    const bookValue = Math.max(salvageValue, initialCost - accumulatedDep)

    return {
      initialCost,
      accumulatedDep,
      bookValue
    }
  }

  const maintenanceTotalByAssetId = useMemo(() => {
    const map = {}
    maintenanceLogs.forEach(log => {
      if (!log.asset_id) return
      map[log.asset_id] = (map[log.asset_id] || 0) + (Number(log.amount) || 0)
    })
    return map
  }, [maintenanceLogs])

  const assetById = useMemo(() => {
    const map = {}
    assets.forEach(a => {
      map[a.id] = a
    })
    return map
  }, [assets])

  const summaryStats = useMemo(() => {
    let totalInitial = 0
    let totalBook = 0
    let totalLandBook = 0
    let activeCount = 0
    let totalMaint = 0

    assets.forEach(a => {
      const val = calcAssetValuation(a)
      if (a.status !== 'INACTIVE') {
        totalInitial += val.initialCost
        totalBook += val.bookValue
        if (a.category === 'LAND') {
          totalLandBook += val.bookValue
        }
      }
      if (a.status === 'ACTIVE') {
        activeCount += 1
      }
    })

    maintenanceLogs.forEach(l => {
      totalMaint += Number(l.amount) || 0
    })

    return { totalInitial, totalBook, totalLandBook, activeCount, totalMaint }
  }, [assets, maintenanceLogs])

  const filteredAssets = useMemo(() => {
    const q = searchAsset.trim().toLowerCase()
    return assets.filter(a => {
      const matchCategory = filterCategory === 'ALL' || a.category === filterCategory
      const matchStatus = filterStatus === 'ALL' || a.status === filterStatus
      const matchSearch =
        !q ||
        a.asset_code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.location_zone && a.location_zone.toLowerCase().includes(q)) ||
        (a.plate_or_doc_ref && a.plate_or_doc_ref.toLowerCase().includes(q))
      return matchCategory && matchStatus && matchSearch
    })
  }, [assets, searchAsset, filterCategory, filterStatus])

  function handleCategoryChange(newCat) {
    const isLand = newCat === 'LAND'
    setAssetForm(prev => ({
      ...prev,
      category: newCat,
      is_depreciable: isLand ? false : true,
      useful_life_years: isLand ? '0' : prev.useful_life_years || '10'
    }))
  }

  function handleSelectEditAsset(asset) {
    setIsEditingAsset(true)
    setAssetForm({
      id: asset.id,
      asset_code: asset.asset_code || '',
      name: asset.name || '',
      category: asset.category || 'BUILDING',
      location_zone: asset.location_zone || '',
      acquired_date: asset.acquired_date || '',
      initial_cost: asset.initial_cost ?? '',
      useful_life_years: asset.useful_life_years ?? '0',
      salvage_value: asset.salvage_value ?? '0',
      is_depreciable: asset.is_depreciable !== false,
      status: asset.status || 'ACTIVE',
      plate_or_doc_ref: asset.plate_or_doc_ref || '',
      note: asset.note || ''
    })
    setMessage(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleResetAssetForm() {
    setIsEditingAsset(false)
    setAssetForm(EMPTY_ASSET_FORM)
  }

  async function handleSaveAsset(e) {
    e.preventDefault()
    if (!assetForm.asset_code.trim() || !assetForm.name.trim()) {
      showToast('error', 'กรุณากรอก รหัสสินทรัพย์ และ ชื่อสินทรัพย์ ให้ครบครับ')
      return
    }

    setSaving(true)
    try {
      const payload = {
        asset_code: assetForm.asset_code.trim(),
        name: assetForm.name.trim(),
        category: assetForm.category,
        location_zone: assetForm.location_zone.trim() || null,
        acquired_date: assetForm.acquired_date || null,
        initial_cost: Number(assetForm.initial_cost) || 0,
        useful_life_years: assetForm.is_depreciable ? Number(assetForm.useful_life_years) || 0 : 0,
        salvage_value: assetForm.is_depreciable ? Number(assetForm.salvage_value) || 0 : 0,
        is_depreciable: Boolean(assetForm.is_depreciable),
        status: assetForm.status,
        plate_or_doc_ref: assetForm.plate_or_doc_ref.trim() || null,
        note: assetForm.note.trim() || null,
        updated_at: new Date().toISOString()
      }

      if (isEditingAsset && assetForm.id) {
        const { error } = await supabase
          .from('fixed_assets')
          .update(payload)
          .eq('id', assetForm.id)
        if (error) throw error
        showToast('success', `✅ อัปเดตสินทรัพย์ "${payload.name}" เรียบร้อยแล้วครับ`)
      } else {
        const { data, error } = await supabase
          .from('fixed_assets')
          .insert([payload])
          .select()
        if (error) throw error
        if (data && data[0] && !selectedAssetId) {
          setSelectedAssetId(data[0].id)
        }
        showToast('success', `✅ เพิ่มสินทรัพย์ใหม่ "${payload.name}" เรียบร้อยแล้วครับ`)
      }

      handleResetAssetForm()
      await fetchAllData()
    } catch (err) {
      console.error('Error saving asset:', err)
      showToast('error', `บันทึกสินทรัพย์ไม่สำเร็จ: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleQuickStatusChange(asset, nextStatus) {
    try {
      const { error } = await supabase
        .from('fixed_assets')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', asset.id)
      if (error) throw error
      await fetchAllData()
      showToast('success', `อัปเดตสถานะ "${asset.name}" เป็น ${STATUS_LABELS[nextStatus]} แล้วครับ`)
    } catch (err) {
      showToast('error', `เปลี่ยนสถานะไม่สำเร็จ: ${err.message}`)
    }
  }

  async function handleAddMaintenanceLog(e) {
    e.preventDefault()
    if (!selectedAssetId) {
      showToast('error', 'กรุณาเลือกสินทรัพย์ก่อนบันทึกรายการครับ')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.from('asset_maintenance_logs').insert([
        {
          asset_id: selectedAssetId,
          log_date: logForm.log_date || new Date().toISOString().slice(0, 10),
          log_type: logForm.log_type,
          amount: Number(logForm.amount) || 0,
          reference_no: logForm.reference_no.trim() || null,
          note: logForm.note.trim() || null
        }
      ])

      if (error) throw error

      setLogForm(prev => ({
        ...prev,
        amount: '',
        reference_no: '',
        note: ''
      }))
      await fetchAllData()
      showToast('success', '✅ บันทึกประวัติซ่อมบำรุง / ดูแลรักษาเรียบร้อยแล้วครับ')
    } catch (err) {
      console.error('Error adding maintenance log:', err)
      showToast('error', `บันทึกประวัติไม่สำเร็จ: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const filteredLogs = useMemo(() => {
    if (filterLogAssetId === 'ALL') return maintenanceLogs
    return maintenanceLogs.filter(l => l.asset_id === filterLogAssetId)
  }, [maintenanceLogs, filterLogAssetId])

  function formatMoney(val) {
    return Number(val || 0).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
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
    fontSize: '13px',
    color: '#1e293b'
  }

  return (
    <div style={{ color: '#1e293b' }}>
      {/* Header */}
      <div style={{ ...cardStyle, background: '#f0fdf4', border: '1px solid #86efac' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, color: '#166534' }}>🏡 ทะเบียนสินทรัพย์ถาวร & การดูแลรักษา</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#374151' }}>
              ดูแลที่ดิน อาคาร โรงเรือน ลานกางเต็นท์ โฮมสเตย์ รถกระบะ รถ APV และประวัติการซ่อมบำรุงของฟาร์ม
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setSubTab('assets')}
              style={{
                padding: '8px 14px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 'bold',
                background: subTab === 'assets' ? '#15803d' : '#e5e7eb',
                color: subTab === 'assets' ? '#ffffff' : '#1f2937'
              }}
            >
              📋 ทะเบียนสินทรัพย์ ({assets.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('maintenance')}
              style={{
                padding: '8px 14px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 'bold',
                background: subTab === 'maintenance' ? '#15803d' : '#e5e7eb',
                color: subTab === 'maintenance' ? '#ffffff' : '#1f2937'
              }}
            >
              🛠️ ซ่อมบำรุง / ต่อภาษี ({maintenanceLogs.length})
            </button>
            <button
              type="button"
              onClick={fetchAllData}
              disabled={loading}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#1f2937',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              🔄 รีเฟรช
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#1e40af' }}>มูลค่าตั้งต้นรวม (ใช้งานอยู่)</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#1e3a8a', marginTop: '4px' }}>
            {formatMoney(summaryStats.totalInitial)} <span style={{ fontSize: '13px', fontWeight: 'normal' }}>บาท</span>
          </div>
        </div>

        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#166534' }}>มูลค่าตามบัญชีโดยประมาณ</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#14532d', marginTop: '4px' }}>
            {formatMoney(summaryStats.totalBook)} <span style={{ fontSize: '13px', fontWeight: 'normal' }}>บาท</span>
          </div>
        </div>

        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#92400e' }}>มูลค่าที่ดิน</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#78350f', marginTop: '4px' }}>
            {formatMoney(summaryStats.totalLandBook)} <span style={{ fontSize: '13px', fontWeight: 'normal' }}>บาท</span>
          </div>
        </div>

        <div style={{ background: '#faf5ff', border: '1px solid #d8b4fe', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#6b21a8' }}>สินทรัพย์ใช้งานปกติ / ค่าซ่อมรวม</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#581c87', marginTop: '6px' }}>
            {summaryStats.activeCount} รายการ • {formatMoney(summaryStats.totalMaint)} บ.
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

      {loading ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: '28px', color: '#64748b' }}>
          กำลังโหลดข้อมูลสินทรัพย์ถาวร...
        </div>
      ) : subTab === 'assets' ? (
        <>
          {/* Add / Edit Asset Form */}
          <form onSubmit={handleSaveAsset} style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>
              {isEditingAsset ? `✏️ แก้ไขสินทรัพย์: ${assetForm.asset_code}` : '➕ เพิ่มรายการสินทรัพย์ถาวร'}
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>รหัสสินทรัพย์ *</label>
                <input
                  type="text"
                  required
                  value={assetForm.asset_code}
                  onChange={e => setAssetForm({ ...assetForm, asset_code: e.target.value })}
                  placeholder="เช่น LAND-01, BLD-01, VEH-01"
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>ชื่อสินทรัพย์ *</label>
                <input
                  type="text"
                  required
                  value={assetForm.name}
                  onChange={e => setAssetForm({ ...assetForm, name: e.target.value })}
                  placeholder="เช่น โรงเรือน 1, โฮมสเตย์หลังที่ 1, รถกระบะ"
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>หมวดหมู่ *</label>
                <select
                  value={assetForm.category}
                  onChange={e => handleCategoryChange(e.target.value)}
                  style={{ ...inputStyle, width: '100%' }}
                >
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>สถานะ</label>
                <select
                  value={assetForm.status}
                  onChange={e => setAssetForm({ ...assetForm, status: e.target.value })}
                  style={{ ...inputStyle, width: '100%' }}
                >
                  {Object.entries(STATUS_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>มูลค่าตั้งต้น / ทุน (บาท) *</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={assetForm.initial_cost}
                  onChange={e => setAssetForm({ ...assetForm, initial_cost: e.target.value })}
                  placeholder="0.00"
                  style={{ ...inputStyle, width: '100%', textAlign: 'right', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>วันที่เริ่มใช้ / สร้างเสร็จ</label>
                <input
                  type="date"
                  value={assetForm.acquired_date}
                  onChange={e => setAssetForm({ ...assetForm, acquired_date: e.target.value })}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>อายุใช้งาน (ปี)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  disabled={!assetForm.is_depreciable}
                  value={assetForm.is_depreciable ? assetForm.useful_life_years : '0'}
                  onChange={e => setAssetForm({ ...assetForm, useful_life_years: e.target.value })}
                  style={{
                    ...inputStyle,
                    width: '100%',
                    textAlign: 'right',
                    background: assetForm.is_depreciable ? '#ffffff' : '#f1f5f9'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>เลขทะเบียน / เลขโฉนด / โซน</label>
                <input
                  type="text"
                  value={assetForm.plate_or_doc_ref}
                  onChange={e => setAssetForm({ ...assetForm, plate_or_doc_ref: e.target.value })}
                  placeholder="เช่น กข-1234 หรือ โฉนดเลขที่..."
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>โซน / จุดที่ตั้งในฟาร์ม</label>
                <input
                  type="text"
                  value={assetForm.location_zone}
                  onChange={e => setAssetForm({ ...assetForm, location_zone: e.target.value })}
                  placeholder="เช่น โซนเพาะปลูก, โซนลานกางเต็นท์, โซนที่พัก"
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>หมายเหตุ / รายละเอียด</label>
                <input
                  type="text"
                  value={assetForm.note}
                  onChange={e => setAssetForm({ ...assetForm, note: e.target.value })}
                  placeholder="เช่น มูลค่าประเมินตั้งต้น / ขนาด / สเปก"
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={assetForm.is_depreciable}
                  onChange={e => setAssetForm({ ...assetForm, is_depreciable: e.target.checked })}
                />
                คิดค่าเสื่อมราคาตามอายุใช้งาน (ปิดสำหรับที่ดิน)
              </label>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    background: '#15803d',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '9px 18px',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  {saving ? 'กำลังบันทึก...' : isEditingAsset ? '💾 บันทึกการแก้ไข' : '💾 บันทึกสินทรัพย์'}
                </button>
                {isEditingAsset && (
                  <button
                    type="button"
                    onClick={handleResetAssetForm}
                    style={{
                      background: '#e5e7eb',
                      color: '#1f2937',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '9px 14px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    ยกเลิก
                  </button>
                )}
              </div>
            </div>
          </form>

          {/* Asset Filter & Table */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
              <input
                type="text"
                value={searchAsset}
                onChange={e => setSearchAsset(e.target.value)}
                placeholder="🔍 ค้นหารหัส ชื่อ โซน หรือทะเบียน/โฉนด..."
                style={{ ...inputStyle, width: '260px', maxWidth: '100%' }}
              />

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  style={inputStyle}
                >
                  <option value="ALL">ทุกหมวดหมู่</option>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>

                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  style={inputStyle}
                >
                  <option value="ALL">ทุกสถานะ</option>
                  {Object.entries(STATUS_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>รหัส / ชื่อสินทรัพย์</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>หมวดหมู่ / โซน</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>มูลค่าตั้งต้น</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>มูลค่าคงเหลือ (บ.)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>ค่าดูแลสะสม</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>สถานะ</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '18px' }}>
                        ยังไม่มีรายการสินทรัพย์ตามเงื่อนไขที่เลือกครับ
                      </td>
                    </tr>
                  ) : (
                    filteredAssets.map(asset => {
                      const val = calcAssetValuation(asset)
                      const maintTotal = maintenanceTotalByAssetId[asset.id] || 0
                      return (
                        <tr key={asset.id} style={{ background: asset.status === 'INACTIVE' ? '#f8fafc' : '#ffffff' }}>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{asset.name}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {asset.asset_code}
                              {asset.plate_or_doc_ref ? ` • ${asset.plate_or_doc_ref}` : ''}
                            </div>
                            {asset.note && <div style={{ fontSize: '11px', color: '#475569' }}>{asset.note}</div>}
                          </td>
                          <td style={tdStyle}>
                            <div>{CATEGORY_LABELS[asset.category] || asset.category}</div>
                            {asset.location_zone && (
                              <div style={{ fontSize: '11px', color: '#64748b' }}>{asset.location_zone}</div>
                            )}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{formatMoney(val.initialCost)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', color: '#166534' }}>
                            {formatMoney(val.bookValue)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: '#0369a1' }}>
                            {formatMoney(maintTotal)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <select
                              value={asset.status}
                              onChange={e => handleQuickStatusChange(asset, e.target.value)}
                              style={{ ...inputStyle, padding: '4px 6px', fontSize: '12px' }}
                            >
                              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleSelectEditAsset(asset)}
                              style={{
                                background: '#ffffff',
                                color: '#1e293b',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                padding: '5px 10px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '12px'
                              }}
                            >
                              แก้ไข
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Tab 2: Maintenance & Care Logs */
        <div>
          <form onSubmit={handleAddMaintenanceLog} style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>🛠️ บันทึกประวัติซ่อมบำรุง / ต่อภาษี / ปรับปรุง</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>เลือกสินทรัพย์ *</label>
                <select
                  value={selectedAssetId}
                  onChange={e => setSelectedAssetId(e.target.value)}
                  style={{ ...inputStyle, width: '100%', fontWeight: 'bold' }}
                >
                  <option value="">-- เลือกสินทรัพย์ --</option>
                  {assets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.asset_code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>วันที่ทำรายการ *</label>
                <input
                  type="date"
                  required
                  value={logForm.log_date}
                  onChange={e => setLogForm({ ...logForm, log_date: e.target.value })}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>ประเภทรายการ *</label>
                <select
                  value={logForm.log_type}
                  onChange={e => setLogForm({ ...logForm, log_type: e.target.value })}
                  style={{ ...inputStyle, width: '100%' }}
                >
                  {Object.entries(LOG_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>ค่าใช้จ่าย (บาท)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={logForm.amount}
                  onChange={e => setLogForm({ ...logForm, amount: e.target.value })}
                  placeholder="0.00"
                  style={{ ...inputStyle, width: '100%', textAlign: 'right', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>เลขอ้างอิง / บิล</label>
                <input
                  type="text"
                  value={logForm.reference_no}
                  onChange={e => setLogForm({ ...logForm, reference_no: e.target.value })}
                  placeholder="ถ้ามี"
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={logForm.note}
                onChange={e => setLogForm({ ...logForm, note: e.target.value })}
                placeholder="รายละเอียด เช่น เปลี่ยนน้ำมันเครื่อง, ต่อภาษีประจำปี, ซ่อมหลังคาโรงเรือน..."
                style={{ ...inputStyle, flex: '1 1 260px' }}
              />
              <button
                type="submit"
                disabled={saving || assets.length === 0}
                style={{
                  background: '#15803d',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 18px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                {saving ? 'กำลังบันทึก...' : '💾 บันทึกรายการดูแล'}
              </button>
            </div>
          </form>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
              <h3 style={{ margin: 0 }}>🕒 ประวัติการซ่อมบำรุงและดูแลรักษา</h3>
              <select
                value={filterLogAssetId}
                onChange={e => setFilterLogAssetId(e.target.value)}
                style={inputStyle}
              >
                <option value="ALL">แสดงทุกสินทรัพย์</option>
                {assets.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.asset_code} — {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>วันที่</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>สินทรัพย์</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>ประเภท</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>ค่าใช้จ่าย (บ.)</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '18px' }}>
                        ยังไม่มีประวัติการซ่อมบำรุงหรือดูแลรักษาครับ
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map(log => {
                      const asset = assetById[log.asset_id]
                      return (
                        <tr key={log.id}>
                          <td style={tdStyle}>
                            {log.log_date
                              ? new Date(log.log_date).toLocaleDateString('th-TH', { dateStyle: 'medium' })
                              : '-'}
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 'bold' }}>
                            {asset ? `${asset.asset_code} — ${asset.name}` : '-'}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {LOG_TYPE_LABELS[log.log_type] || log.log_type}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', color: '#0369a1' }}>
                            {formatMoney(log.amount)}
                          </td>
                          <td style={tdStyle}>
                            {log.note || '-'}
                            {log.reference_no ? ` (อ้างอิง: ${log.reference_no})` : ''}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}