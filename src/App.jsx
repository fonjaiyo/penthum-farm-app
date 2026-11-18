import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import './App.css'

export default function App() {
  const [activeTab, setActiveTab] = useState('order')

  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  // ==========================================
  // STATE: หน้าบันทึกคำสั่งซื้อ (Order)
  // ==========================================
  const [customerName, setCustomerName] = useState('')
  const [quantities, setQuantities] = useState({})
  const [submittingOrder, setSubmittingOrder] = useState(false)

  const [orderStep, setOrderStep] = useState('form') // 'form' | 'confirm' | 'success'
  const [pendingOrderData, setPendingOrderData] = useState(null)
  const [completedOrderText, setCompletedOrderText] = useState('')

  // ==========================================
  // STATE: หน้าจัดการสินค้า (Product CRUD)
  // ==========================================
  const [productSearch, setProductSearch] = useState('')
  const [showInactiveProducts, setShowInactiveProducts] = useState(false)
  const [isEditingProduct, setIsEditingProduct] = useState(false)
  const [savingProduct, setSavingProduct] = useState(false)
  const [productForm, setProductForm] = useState({
    sku: '',
    name: '',
    unit: '',
    selling_price: '',
    is_active: true
  })

  // ==========================================
  // STATE: หน้าจัดการลูกค้า (Customer CRUD)
  // ==========================================
  const [customerSearch, setCustomerSearch] = useState('')
  const [showInactiveCustomers, setShowInactiveCustomers] = useState(false)
  const [isEditingCustomer, setIsEditingCustomer] = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [customerForm, setCustomerForm] = useState({
    id: null,
    name: '',
    phone: '',
    address: '',
    note: '',
    is_active: true
  })

  useEffect(() => {
    fetchAllData()
  }, [])

  async function fetchAllData() {
    try {
      setLoading(true)
      await Promise.all([fetchProducts(), fetchCustomers()])
    } catch (error) {
      console.error('Error fetching data:', error.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchProducts() {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('sku', { ascending: true })
    if (error) throw error
    setProducts(data || [])
  }

  async function fetchCustomers() {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('name', { ascending: true })
    if (error) throw error
    setCustomers(data || [])
  }

  // ==========================================
  // LOGIC: สั่งซื้อ - ขั้นตอนที่ 1: ตรวจสอบข้อมูล
  // ==========================================
  const activeProducts = products.filter(p => p.is_active !== false)
  const activeCustomers = customers.filter(c => c.is_active !== false)

  function handleQuantityChange(sku, value) {
    setQuantities(prev => ({ ...prev, [sku]: value }))
  }

  const totalOrderAmount = activeProducts.reduce((sum, p) => {
    const qty = Number(quantities[p.sku]) || 0
    return sum + (p.selling_price * qty)
  }, 0)

  function handleReviewOrder(e) {
    e.preventDefault()
    const trimmedCustomerName = customerName.trim()
    if (!trimmedCustomerName) {
      setMessage('❌ กรุณากรอกหรือเลือกชื่อลูกค้าก่อนครับ')
      return
    }

    const orderedItems = activeProducts
      .map(p => ({ product: p, qty: Number(quantities[p.sku]) || 0 }))
      .filter(item => item.qty > 0)

    if (orderedItems.length === 0) {
      setMessage('❌ กรุณาใส่จำนวนสินค้าอย่างน้อย 1 รายการครับ')
      return
    }

    const customerInfo = activeCustomers.find(
      c => c.name.toLowerCase() === trimmedCustomerName.toLowerCase()
    )

    setPendingOrderData({
      customerName: trimmedCustomerName,
      customerPhone: customerInfo ? customerInfo.phone : '-',
      customerAddress: customerInfo ? customerInfo.address : '-',
      items: orderedItems,
      totalAmount: totalOrderAmount
    })

    setMessage('')
    setOrderStep('confirm')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ==========================================
  // LOGIC: สั่งซื้อ - ขั้นตอนที่ 2 (Y/N): บันทึกลง Supabase จริง
  // ==========================================
  async function handleConfirmSaveOrder() {
    if (!pendingOrderData) return

    try {
      setSubmittingOrder(true)
      setMessage('')

      const { customerName: cName, items, totalAmount } = pendingOrderData

      const existingCust = activeCustomers.find(
        c => c.name.toLowerCase() === cName.toLowerCase()
      )
      if (!existingCust) {
        await supabase.from('customers').insert([{ name: cName, is_active: true }])
        await fetchCustomers()
      }

      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert([{ customer_name: cName, total_amount: totalAmount, status: 'Pending' }])
        .select()

      if (orderError) throw orderError
      const newOrderId = orderData[0].id

      const itemsToInsert = items.map(item => ({
        order_id: newOrderId,
        product_sku: item.product.sku,
        product_name: item.product.name,
        quantity: item.qty,
        price_unit: item.product.selling_price,
        subtotal: item.product.selling_price * item.qty
      }))

      const { error: itemError } = await supabase.from('order_items').insert(itemsToInsert)
      if (itemError) throw itemError

      // ปรับข้อความสรุป (เอาเครื่องหมาย ** ออก เพื่อให้เวลาส่งไลน์อ่านง่ายสะอาดตาครับ)
      let summaryText = `🌱 ฟาร์มเป็นธรรม - ยืนยันคำสั่งซื้อ\n`;
      summaryText += `------------------------------------\n`;
      summaryText += `👤 ลูกค้า: ${cName}\n`;
      summaryText += `📅 วันที่: ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}\n`;
      summaryText += `------------------------------------\n`;
      summaryText += `📦 รายการสินค้า:\n`;
      items.forEach((item, idx) => {
        summaryText += `${idx + 1}. ${item.product.name} (${item.product.sku}) x ${item.qty} ${item.product.unit} = ${(item.product.selling_price * item.qty).toLocaleString()} บาท\n`;
      });
      summaryText += `------------------------------------\n`;
      summaryText += `💰 ยอดรวมทั้งสิ้น: ${totalAmount.toLocaleString()} บาท\n`;
      summaryText += `🙏 ขอบพระคุณที่อุดหนุนฟาร์มเป็นธรรมครับ ❤️`;

      setCompletedOrderText(summaryText)
      setOrderStep('success')
    } catch (error) {
      setMessage('❌ เกิดข้อผิดพลาดในการบันทึก: ' + error.message)
      setOrderStep('form')
    } finally {
      setSubmittingOrder(false)
    }
  }

  function handleCancelOrder() {
    setOrderStep('form')
  }

  function handleResetNewOrder() {
    setCustomerName('')
    setQuantities({})
    setPendingOrderData(null)
    setCompletedOrderText('')
    setOrderStep('form')
  }

  // ==========================================
  // LOGIC: จัดการสินค้า (Product CRUD)
  // ==========================================
  const filteredProducts = products.filter(p => {
    const matchesSearch =
      p.sku.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.name.toLowerCase().includes(productSearch.toLowerCase())
    const isActive = p.is_active !== false
    return matchesSearch && (showInactiveProducts ? true : isActive)
  })

  function resetProductForm() {
    setIsEditingProduct(false)
    setProductForm({ sku: '', name: '', unit: '', selling_price: '', is_active: true })
  }

  function handleSelectEditProduct(product) {
    setIsEditingProduct(true)
    setProductForm({
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      selling_price: product.selling_price,
      is_active: product.is_active !== false
    })
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSaveProduct(e) {
    e.preventDefault()
    if (!productForm.sku.trim() || !productForm.name.trim() || !productForm.unit.trim()) {
      setMessage('❌ กรุณากรอก รหัส SKU, ชื่อสินค้า และหน่วยนับ ให้ครบถ้วนครับ')
      return
    }

    try {
      setSavingProduct(true)
      setMessage('')
      const payload = {
        sku: productForm.sku.trim(),
        name: productForm.name.trim(),
        unit: productForm.unit.trim(),
        selling_price: Number(productForm.selling_price) || 0,
        is_active: productForm.is_active
      }

      if (isEditingProduct) {
        const { error } = await supabase
          .from('products')
          .update({ name: payload.name, unit: payload.unit, selling_price: payload.selling_price, is_active: payload.is_active })
          .eq('sku', payload.sku)
        if (error) throw error
        setMessage(`✅ แก้ไขข้อมูลสินค้า "${payload.name}" เรียบร้อยแล้ว!`)
      } else {
        const { error } = await supabase.from('products').insert([payload])
        if (error) throw error
        setMessage(`✅ เพิ่มสินค้าใหม่ "${payload.name}" เรียบร้อยแล้ว!`)
      }

      resetProductForm()
      await fetchProducts()
    } catch (error) {
      setMessage('❌ บันทึกสินค้าไม่สำเร็จ: ' + error.message)
    } finally {
      setSavingProduct(false)
    }
  }

  async function handleToggleActiveProduct(product) {
    const newStatus = product.is_active === false
    try {
      const { error } = await supabase
        .from('products')
        .update({ is_active: newStatus })
        .eq('sku', product.sku)
      if (error) throw error
      await fetchProducts()
    } catch (error) {
      setMessage('❌ เปลี่ยนสถานะไม่สำเร็จ: ' + error.message)
    }
  }

  // ==========================================
  // LOGIC: จัดการลูกค้า (Customer CRUD)
  // ==========================================
  const filteredCustomers = customers.filter(c => {
    const matchesSearch =
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      (c.phone && c.phone.includes(customerSearch))
    const isActive = c.is_active !== false
    return matchesSearch && (showInactiveCustomers ? true : isActive)
  })

  function resetCustomerForm() {
    setIsEditingCustomer(false)
    setCustomerForm({ id: null, name: '', phone: '', address: '', note: '', is_active: true })
  }

  function handleSelectEditCustomer(cust) {
    setIsEditingCustomer(true)
    setCustomerForm({
      id: cust.id,
      name: cust.name,
      phone: cust.phone || '',
      address: cust.address || '',
      note: cust.note || '',
      is_active: cust.is_active !== false
    })
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSaveCustomer(e) {
    e.preventDefault()
    if (!customerForm.name.trim()) {
      setMessage('❌ กรุณากรอกชื่อลูกค้าก่อนบันทึกครับ')
      return
    }

    try {
      setSavingCustomer(true)
      setMessage('')
      const payload = {
        name: customerForm.name.trim(),
        phone: customerForm.phone.trim(),
        address: customerForm.address.trim(),
        note: customerForm.note.trim(),
        is_active: customerForm.is_active
      }

      if (isEditingCustomer) {
        const { error } = await supabase
          .from('customers')
          .update(payload)
          .eq('id', customerForm.id)
        if (error) throw error
        setMessage(`✅ แก้ไขข้อมูลลูกค้า "${payload.name}" เรียบร้อยแล้ว!`)
      } else {
        const { error } = await supabase.from('customers').insert([payload])
        if (error) throw error
        setMessage(`✅ เพิ่มลูกค้าใหม่ "${payload.name}" เรียบร้อยแล้ว!`)
      }

      resetCustomerForm()
      await fetchCustomers()
    } catch (error) {
      setMessage('❌ บันทึกลูกค้าไม่สำเร็จ: ' + error.message)
    } finally {
      setSavingCustomer(false)
    }
  }

  async function handleToggleActiveCustomer(cust) {
    const newStatus = cust.is_active === false
    try {
      const { error } = await supabase
        .from('customers')
        .update({ is_active: newStatus })
        .eq('id', cust.id)
      if (error) throw error
      await fetchCustomers()
    } catch (error) {
      setMessage('❌ เปลี่ยนสถานะไม่สำเร็จ: ' + error.message)
    }
  }

  return (
    <div style={{ padding: '16px', fontFamily: 'sans-serif', maxWidth: '950px', margin: '0 auto', color: '#222' }}>
      <h1 style={{ marginBottom: '12px' }}>🌱 ฟาร์มเป็นธรรม</h1>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '2px solid #e0e0e0', paddingBottom: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => { setActiveTab('order'); setMessage('') }}
          style={{
            padding: '10px 18px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '15px',
            background: activeTab === 'order' ? '#2e7d32' : '#eeeeee',
            color: activeTab === 'order' ? '#ffffff' : '#333333'
          }}
        >
          📝 บันทึกคำสั่งซื้อ
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('product'); setMessage('') }}
          style={{
            padding: '10px 18px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '15px',
            background: activeTab === 'product' ? '#1565c0' : '#eeeeee',
            color: activeTab === 'product' ? '#ffffff' : '#333333'
          }}
        >
          📦 จัดการสินค้า (Product)
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('customer'); setMessage('') }}
          style={{
            padding: '10px 18px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '15px',
            background: activeTab === 'customer' ? '#6a1b9a' : '#eeeeee',
            color: activeTab === 'customer' ? '#ffffff' : '#333333'
          }}
        >
          👥 จัดการลูกค้า (Customer)
        </button>
      </div>

      {message && (
        <div style={{ padding: '12px', marginBottom: '16px', borderRadius: '6px', background: '#fff3cd', border: '1px solid #ffeeba', fontWeight: 'bold' }}>
          {message}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 1: บันทึกคำสั่งซื้อ                                                 */}
      {/* ===================================================================== */}
      {activeTab === 'order' && (
        <div>
          {orderStep === 'form' && (
            <form onSubmit={handleReviewOrder}>
              <div style={{ background: '#f5f5f5', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ddd' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  ชื่อลูกค้า / ผู้สั่งซื้อ (เลือกจากรายการ หรือพิมพ์ชื่อใหม่ได้เลย):
                </label>
                <input
                  type="text"
                  list="customer-list"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="เช่น พี่รำพึง หรือ ค้นหาชื่อลูกค้า..."
                  style={{ width: '100%', padding: '10px', boxSizing: 'border-box', fontSize: '16px' }}
                />
                <datalist id="customer-list">
                  {activeCustomers.map((cust) => (
                    <option key={cust.id} value={cust.name} />
                  ))}
                </datalist>
                <small style={{ display: 'block', marginTop: '6px', color: '#666' }}>
                  💡 หากพิมพ์ชื่อใหม่ที่ยังไม่มีในระบบ เมื่อกดตรวจสอบออเดอร์ ระบบจะบันทึกชื่อนี้ลงฐานข้อมูลลูกค้าให้อัตโนมัติครับ
                </small>
              </div>

              <h2>📦 รายการสินค้าพร้อมขาย ({activeProducts.length} รายการ)</h2>
              {loading ? (
                <p>กำลังโหลดข้อมูล...</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table border="1" cellPadding="8" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', background: '#fff' }}>
                    <thead>
                      <tr style={{ background: '#e8f5e9' }}>
                        <th>SKU</th>
                        <th>ชื่อสินค้า</th>
                        <th>หน่วย</th>
                        <th>ราคา (บาท)</th>
                        <th style={{ width: '100px' }}>จำนวนสั่ง</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeProducts.map((p) => (
                        <tr key={p.sku}>
                          <td>{p.sku}</td>
                          <td>{p.name}</td>
                          <td>{p.unit}</td>
                          <td style={{ textAlign: 'right' }}>{Number(p.selling_price).toLocaleString()}</td>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="number"
                              min="0"
                              value={quantities[p.sku] || ''}
                              onChange={(e) => handleQuantityChange(p.sku, e.target.value)}
                              placeholder="0"
                              style={{ width: '65px', padding: '6px', textAlign: 'center', fontSize: '16px' }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ background: '#e3f2fd', padding: '16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', border: '1px solid #bbdefb' }}>
                <h3 style={{ margin: 0, color: '#0d47a1' }}>ยอดรวมทั้งสิ้น: {totalOrderAmount.toLocaleString()} บาท</h3>
                <button
                  type="submit"
                  style={{ background: '#1565c0', color: 'white', padding: '12px 24px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
                >
                  🔍 ตรวจสอบรายการก่อนบันทึก
                </button>
              </div>
            </form>
          )}

          {orderStep === 'confirm' && pendingOrderData && (
            <div style={{ background: '#fffde7', padding: '20px', borderRadius: '8px', border: '2px solid #fbc02d' }}>
              <h2 style={{ marginTop: 0, color: '#f57f17' }}>⚠️ กรุณาตรวจสอบความถูกต้อง (ยืนยันคำสั่งซื้อ)</h2>
              <p style={{ color: '#555' }}>โปรดตรวจสอบข้อมูลลูกค้าและรายการสินค้าด้านล่างนี้ หากถูกต้องให้กดปุ่ม <b>"ยืนยันบันทึก (Y)"</b> หรือหากต้องการแก้ไขให้กด <b>"ย้อนกลับ (N)"</b></p>

              <div style={{ background: '#fff', padding: '15px', borderRadius: '6px', marginBottom: '16px', border: '1px solid #ddd' }}>
                <p style={{ margin: '4px 0' }}><b>👤 ชื่อลูกค้า:</b> {pendingOrderData.customerName}</p>
                <p style={{ margin: '4px 0' }}><b>📞 เบอร์โทร:</b> {pendingOrderData.customerPhone}</p>
                <p style={{ margin: '4px 0' }}><b>📍 ที่อยู่:</b> {pendingOrderData.customerAddress}</p>
              </div>

              <h3>🛒 รายการสินค้าที่สั่ง ({pendingOrderData.items.length} รายการ)</h3>
              <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                <table border="1" cellPadding="8" style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                  <thead>
                    <tr style={{ background: '#fff9c4' }}>
                      <th>SKU</th>
                      <th>ชื่อสินค้า</th>
                      <th>จำนวน</th>
                      <th>ราคา/หน่วย</th>
                      <th>รวม (บาท)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingOrderData.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.product.sku}</td>
                        <td>{item.product.name}</td>
                        <td style={{ textAlign: 'center' }}>{item.qty} {item.product.unit}</td>
                        <td style={{ textAlign: 'right' }}>{Number(item.product.selling_price).toLocaleString()}</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{(item.product.selling_price * item.qty).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ background: '#e8f5e9', padding: '15px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, color: '#2e7d32' }}>ยอดรวมทั้งสิ้น: {pendingOrderData.totalAmount.toLocaleString()} บาท</h2>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  onClick={handleConfirmSaveOrder}
                  disabled={submittingOrder}
                  style={{ background: '#2e7d32', color: 'white', padding: '12px 24px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', flex: 1 }}
                >
                  {submittingOrder ? 'กำลังบันทึก...' : '✅ ยืนยันบันทึก (Y - Save)'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelOrder}
                  disabled={submittingOrder}
                  style={{ background: '#d32f2f', color: 'white', padding: '12px 24px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', flex: 1 }}
                >
                  ❌ ยกเลิก/กลับไปแก้ไข (N - Back)
                </button>
              </div>
            </div>
          )}

          {orderStep === 'success' && (
            <div style={{ background: '#e8f5e9', padding: '20px', borderRadius: '8px', border: '2px solid #2e7d32' }}>
              <h2 style={{ marginTop: 0, color: '#2e7d32' }}>🎉 บันทึกคำสั่งซื้อสำเร็จเรียบร้อยแล้ว!</h2>
              <p>คุณสามารถกดปุ่มด้านล่างเพื่อคัดลอกข้อความสรุป แล้วนำไปส่งให้ลูกค้าทาง Line หรือ Messenger ได้ทันทีครับ</p>

              <div style={{ marginBottom: '16px' }}>
                {/* 🌟 ปรับสีพื้นหลังเป็นขาวสะอาด (background: #fff) และตัวหนังสือสีดำ (#222) เพื่อให้อ่านชัดเจนในทุกโหมด */}
                <textarea
                  readOnly
                  value={completedOrderText}
                  rows="11"
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    fontSize: '15px', 
                    fontFamily: 'monospace', 
                    borderRadius: '6px', 
                    border: '1px solid #ccc', 
                    boxSizing: 'border-box', 
                    background: '#ffffff', 
                    color: '#222222' 
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(completedOrderText)
                    alert('📋 คัดลอกข้อความเรียบร้อยแล้ว! นำไปวางใน Line ส่งให้ลูกค้าได้เลยครับ')
                  }}
                  style={{ background: '#00c300', color: 'white', padding: '12px 24px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', flex: 1 }}
                >
                  📋 คัดลอกข้อความ (Copy to Clipboard)
                </button>
                <button
                  type="button"
                  onClick={handleResetNewOrder}
                  style={{ background: '#1565c0', color: 'white', padding: '12px 24px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
                >
                  ➕ ทำรายการใหม่อีกบิล
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: จัดการสินค้า (Product)                                          */}
      {/* ===================================================================== */}
      {activeTab === 'product' && (
        <div>
          <div style={{ background: isEditingProduct ? '#fff8e1' : '#f1f8e9', padding: '16px', borderRadius: '8px', marginBottom: '24px', border: '1px solid #ccc' }}>
            <h3 style={{ marginTop: 0 }}>
              {isEditingProduct ? `✏️ แก้ไขสินค้า: ${productForm.sku}` : '➕ เพิ่มสินค้าใหม่'}
            </h3>
            <form onSubmit={handleSaveProduct} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>รหัส SKU *</label>
                <input
                  type="text"
                  disabled={isEditingProduct}
                  value={productForm.sku}
                  onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
                  placeholder="เช่น BEV-005"
                  style={{ width: '100%', padding: '8px', boxSizing: 'border-box', background: isEditingProduct ? '#e0e0e0' : '#fff' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>ชื่อสินค้า *</label>
                <input
                  type="text"
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  placeholder="เช่น น้ำเคลสกัดเย็น"
                  style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>หน่วยนับ *</label>
                <input
                  type="text"
                  value={productForm.unit}
                  onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })}
                  placeholder="เช่น ขวด, แพ็ค"
                  style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>ราคาขาย (บาท) *</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={productForm.selling_price}
                  onChange={(e) => setProductForm({ ...productForm, selling_price: e.target.value })}
                  placeholder="0"
                  style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                <button
                  type="submit"
                  disabled={savingProduct}
                  style={{ background: isEditingProduct ? '#ef6c00' : '#1565c0', color: 'white', padding: '9px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', flex: 1 }}
                >
                  {savingProduct ? 'กำลังบันทึก...' : isEditingProduct ? '💾 บันทึกการแก้ไข' : '➕ เพิ่มสินค้า'}
                </button>
                {isEditingProduct && (
                  <button
                    type="button"
                    onClick={resetProductForm}
                    style={{ background: '#757575', color: 'white', padding: '9px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    ยกเลิก
                  </button>
                )}
              </div>
            </form>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="🔍 ค้นหาจาก SKU หรือ ชื่อสินค้า..."
              style={{ padding: '9px', width: '280px', maxWidth: '100%', fontSize: '15px' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={showInactiveProducts}
                onChange={(e) => setShowInactiveProducts(e.target.checked)}
              />
              แสดงรายการที่ "ยกเลิกขาย" ด้วย
            </label>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table border="1" cellPadding="8" style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
              <thead>
                <tr style={{ background: '#e3f2fd' }}>
                  <th>SKU</th>
                  <th>ชื่อสินค้า</th>
                  <th>หน่วย</th>
                  <th>ราคา (บาท)</th>
                  <th>สถานะ</th>
                  <th style={{ width: '160px' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '16px' }}>ไม่พบรายการสินค้า</td></tr>
                ) : (
                  filteredProducts.map((p) => {
                    const isActive = p.is_active !== false
                    return (
                      <tr key={p.sku} style={{ background: isActive ? '#fff' : '#f5f5f5', color: isActive ? '#222' : '#888' }}>
                        <td>{p.sku}</td>
                        <td style={{ textDecoration: isActive ? 'none' : 'line-through' }}>{p.name}</td>
                        <td>{p.unit}</td>
                        <td style={{ textAlign: 'right' }}>{Number(p.selling_price).toLocaleString()}</td>
                        <td style={{ textAlign: 'center', fontWeight: 'bold', color: isActive ? '#2e7d32' : '#c62828' }}>
                          {isActive ? '🟢 ปกติ' : '🔴 ยกเลิกขาย'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleSelectEditProduct(p)}
                              style={{ background: '#ffa000', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleActiveProduct(p)}
                              style={{ background: isActive ? '#d32f2f' : '#388e3c', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                              {isActive ? 'ยกเลิก' : 'เปิดขาย'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: จัดการลูกค้า (Customer)                                         */}
      {/* ===================================================================== */}
      {activeTab === 'customer' && (
        <div>
          <div style={{ background: isEditingCustomer ? '#fff3e0' : '#f3e5f5', padding: '16px', borderRadius: '8px', marginBottom: '24px', border: '1px solid #ccc' }}>
            <h3 style={{ marginTop: 0 }}>
              {isEditingCustomer ? `✏️ แก้ไขข้อมูลลูกค้า: ${customerForm.name}` : '➕ เพิ่มลูกค้าใหม่'}
            </h3>
            <form onSubmit={handleSaveCustomer} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>ชื่อลูกค้า / ร้านค้า *</label>
                <input
                  type="text"
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  placeholder="เช่น พี่รำพึง หรือ ร้านสุขภาพ"
                  style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>เบอร์โทรศัพท์</label>
                <input
                  type="text"
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  placeholder="เช่น 081-234-5678"
                  style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>ที่อยู่จัดส่ง</label>
                <textarea
                  value={customerForm.address}
                  onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                  placeholder="บ้านเลขที่, ถนน, ตำบล, อำเภอ, จังหวัด, รหัสไปรษณีย์"
                  rows="2"
                  style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>หมายเหตุ</label>
                <input
                  type="text"
                  value={customerForm.note}
                  onChange={(e) => setCustomerForm({ ...customerForm, note: e.target.value })}
                  placeholder="เช่น ส่งวันจันทร์/พฤหัส"
                  style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                <button
                  type="submit"
                  disabled={savingCustomer}
                  style={{ background: isEditingCustomer ? '#ef6c00' : '#6a1b9a', color: 'white', padding: '9px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', flex: 1 }}
                >
                  {savingCustomer ? 'กำลังบันทึก...' : isEditingCustomer ? '💾 บันทึกการแก้ไข' : '➕ เพิ่มลูกค้า'}
                </button>
                {isEditingCustomer && (
                  <button
                    type="button"
                    onClick={resetCustomerForm}
                    style={{ background: '#757575', color: 'white', padding: '9px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    ยกเลิก
                  </button>
                )}
              </div>
            </form>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="🔍 ค้นหาจากชื่อ หรือ เบอร์โทร..."
              style={{ padding: '9px', width: '280px', maxWidth: '100%', fontSize: '15px' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={showInactiveCustomers}
                onChange={(e) => setShowInactiveCustomers(e.target.checked)}
              />
              แสดงลูกค้าที่ปิดใช้งานด้วย
            </label>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table border="1" cellPadding="8" style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
              <thead>
                <tr style={{ background: '#f3e5f5' }}>
                  <th>ชื่อลูกค้า / ร้านค้า</th>
                  <th>เบอร์โทร</th>
                  <th>ที่อยู่จัดส่ง</th>
                  <th>หมายเหตุ</th>
                  <th>สถานะ</th>
                  <th style={{ width: '160px' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '16px' }}>ไม่พบรายชื่อลูกค้า</td></tr>
                ) : (
                  filteredCustomers.map((cust) => {
                    const isActive = cust.is_active !== false
                    return (
                      <tr key={cust.id} style={{ background: isActive ? '#fff' : '#f5f5f5', color: isActive ? '#222' : '#888' }}>
                        <td style={{ fontWeight: 'bold', textDecoration: isActive ? 'none' : 'line-through' }}>{cust.name}</td>
                        <td>{cust.phone || '-'}</td>
                        <td>{cust.address || '-'}</td>
                        <td>{cust.note || '-'}</td>
                        <td style={{ textAlign: 'center', fontWeight: 'bold', color: isActive ? '#2e7d32' : '#c62828' }}>
                          {isActive ? '🟢 ปกติ' : '🔴 ปิดใช้งาน'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleSelectEditCustomer(cust)}
                              style={{ background: '#ffa000', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleActiveCustomer(cust)}
                              style={{ background: isActive ? '#d32f2f' : '#388e3c', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                              {isActive ? 'ปิด' : 'เปิด'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}