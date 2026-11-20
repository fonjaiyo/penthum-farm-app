import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import './App.css'

export default function App() {
  // เมนูหลัก: 'order' | 'manage_orders' | 'product' | 'customer'
  const [activeTab, setActiveTab] = useState('order')

  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  // ==========================================
  // STATE: หน้าบันทึกคำสั่งซื้อใหม่ (Create Order)
  // ==========================================
  const [customerName, setCustomerName] = useState('')
  const [quantities, setQuantities] = useState({})
  const [submittingOrder, setSubmittingOrder] = useState(false)

  const [orderStep, setOrderStep] = useState('form') // 'form' | 'confirm' | 'success'
  const [pendingOrderData, setPendingOrderData] = useState(null)
  const [completedOrderText, setCompletedOrderText] = useState('')

  // ==========================================
  // STATE: หน้าจัดการคำสั่งซื้อ (Manage Orders, Edit & Top VI/VO/PI/PA)
  // ==========================================
  const [orderSearch, setOrderSearch] = useState('')
  const [editingOrder, setEditingOrder] = useState(null)
  const [editOrderCustomer, setEditOrderCustomer] = useState('')
  const [editOrderQuantities, setEditOrderQuantities] = useState({})
  const [savingEditOrder, setSavingEditOrder] = useState(false)

  // โหมดการทำงานด้านบนในหน้าจัดการคำสั่งซื้อ: 'list' | 'VI' | 'VO' | 'PI' | 'PA'
  const [fulfillmentMode, setFulfillmentMode] = useState('list')
  // เก็บจำนวนของที่ขาดราย SKU ในหน้า VI เช่น { 'BEV-001': 2 }
  const [shortageInputs, setShortageInputs] = useState({})
  // ผลลัพธ์หลังกดยืนยัน VI: null | 'ready' | { text: '...' }
  const [viResult, setViResult] = useState(null)
  const [confirmingVi, setConfirmingVi] = useState(false)

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
      await Promise.all([fetchProducts(), fetchCustomers(), fetchOrders()])
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

  async function fetchOrders() {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('id', { ascending: false })
    if (error) throw error
    setOrders(data || [])
  }

  // ==========================================
  // LOGIC: บันทึกคำสั่งซื้อใหม่ (Create Order)
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
        .insert([{
          customer_name: cName,
          total_amount: totalAmount,
          status: 'Pending',
          vi_done: false,
          vo_done: false,
          pi_done: false,
          pa_done: false
        }])
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

      let summaryText = `🌱 ฟาร์มเป็นธรรม - ยืนยันคำสั่งซื้อ\n`
      summaryText += `------------------------------------\n`
      summaryText += `🧾 เลขที่บิล: #${newOrderId}\n`
      summaryText += `👤 ลูกค้า: ${cName}\n`
      summaryText += `📅 วันที่: ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}\n`
      summaryText += `------------------------------------\n`
      summaryText += `📦 รายการสินค้า:\n`
      items.forEach((item, idx) => {
        summaryText += `${idx + 1}. ${item.product.name} (${item.product.sku}) x ${item.qty} ${item.product.unit} = ${(item.product.selling_price * item.qty).toLocaleString()} บาท\n`
      })
      summaryText += `------------------------------------\n`
      summaryText += `💰 ยอดรวมทั้งสิ้น: ${totalAmount.toLocaleString()} บาท\n`
      summaryText += `🙏 ขอบพระคุณที่อุดหนุนฟาร์มเป็นธรรมครับ ❤️`

      setCompletedOrderText(summaryText)
      setOrderStep('success')
      await fetchOrders()
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
  // LOGIC: จัดการคำสั่งซื้อ (Edit Order & Top VI/VO/PI/PA)
  // ==========================================
  const filteredOrders = orders.filter(o =>
    o.customer_name.toLowerCase().includes(orderSearch.toLowerCase()) ||
    String(o.id).includes(orderSearch)
  )

  // เปิดหน้าจอแก้ไขบิล (คงเดิมตามที่พี่โยต้องการ)
  function handleStartEditOrder(order) {
    setEditingOrder(order)
    setEditOrderCustomer(order.customer_name)

    const initialQty = {}
    if (order.order_items) {
      order.order_items.forEach(item => {
        initialQty[item.product_sku] = item.quantity
      })
    }
    setEditOrderQuantities(initialQty)
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSaveEditedOrder(e) {
    e.preventDefault()
    if (!editingOrder) return

    const trimmedCust = editOrderCustomer.trim()
    if (!trimmedCust) {
      setMessage('❌ กรุณากรอกชื่อลูกค้าครับ')
      return
    }

    const updatedItems = products
      .map(p => ({ product: p, qty: Number(editOrderQuantities[p.sku]) || 0 }))
      .filter(item => item.qty > 0)

    if (updatedItems.length === 0) {
      setMessage('❌ บิลต้องมีสินค้าอย่างน้อย 1 รายการครับ')
      return
    }

    const newTotal = updatedItems.reduce(
      (sum, item) => sum + item.product.selling_price * item.qty,
      0
    )

    try {
      setSavingEditOrder(true)
      setMessage('')

      const { error: updateOrderError } = await supabase
        .from('orders')
        .update({ customer_name: trimmedCust, total_amount: newTotal })
        .eq('id', editingOrder.id)
      if (updateOrderError) throw updateOrderError

      const { error: deleteItemsError } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', editingOrder.id)
      if (deleteItemsError) throw deleteItemsError

      const newItemsPayload = updatedItems.map(item => ({
        order_id: editingOrder.id,
        product_sku: item.product.sku,
        product_name: item.product.name,
        quantity: item.qty,
        price_unit: item.product.selling_price,
        subtotal: item.product.selling_price * item.qty
      }))

      const { error: insertItemsError } = await supabase
        .from('order_items')
        .insert(newItemsPayload)
      if (insertItemsError) throw insertItemsError

      setMessage(`✅ แก้ไขบิล #${editingOrder.id} ของ "${trimmedCust}" เรียบร้อยแล้ว!`)
      setEditingOrder(null)
      await fetchOrders()
    } catch (error) {
      setMessage('❌ บันทึกการแก้ไขบิลไม่สำเร็จ: ' + error.message)
    } finally {
      setSavingEditOrder(false)
    }
  }

  // เลือกโหมดด้านบน VI / VO / PI / PA
  function handleSelectFulfillmentMode(mode) {
    setFulfillmentMode(prev => (prev === mode ? 'list' : mode))
    setViResult(null)
    setMessage('')
  }

  // รวมจำนวนสินค้าของทุก Order เพื่อแสดงในตาราง VI
  function buildProductSummaryForVi() {
    const summaryMap = {}

    orders.forEach(order => {
      if (!order.order_items) return
      order.order_items.forEach(item => {
        const sku = item.product_sku
        const productInfo = products.find(p => p.sku === sku)
        const unit = productInfo ? productInfo.unit : 'หน่วย'

        if (!summaryMap[sku]) {
          summaryMap[sku] = {
            sku,
            name: item.product_name,
            unit,
            totalQty: 0
          }
        }
        summaryMap[sku].totalQty += Number(item.quantity) || 0
      })
    })

    return Object.values(summaryMap).sort((a, b) => a.sku.localeCompare(b.sku))
  }

  const viProductSummary = buildProductSummaryForVi()

  // ยืนยันผลตรวจสอบ VI: คำนวณการจัดสรรของตามลำดับ Order ที่สั่งก่อน
  async function handleConfirmViCheck(e) {
    e.preventDefault()
    try {
      setConfirmingVi(true)
      setMessage('')

      // ตรวจสอบว่ามีการกรอกจำนวนสินค้าที่ขาด (> 0) หรือไม่
      const shortageBySku = {}
      let hasAnyShortage = false

      viProductSummary.forEach(row => {
        const rawShort = Number(shortageInputs[row.sku]) || 0
        const clampedShort = Math.max(0, Math.min(rawShort, row.totalQty))
        if (clampedShort > 0) {
          hasAnyShortage = true
          shortageBySku[row.sku] = clampedShort
        }
      })

      // อัปเดตสถานะ vi_done = true สำหรับออเดอร์ทั้งหมด
      if (orders.length > 0) {
        const orderIds = orders.map(o => o.id)
        const { error } = await supabase
          .from('orders')
          .update({ vi_done: true })
          .in('id', orderIds)
        if (error) throw error
        await fetchOrders()
      }

      if (!hasAnyShortage) {
        setViResult('ready')
        return
      }

      // กรณีมีของขาด: จัดสรรสินค้าที่มีให้กับ Order ที่สั่งก่อน (เรียงตาม id จากน้อยไปมาก)
      // ของที่มีทั้งหมดของแต่ละ SKU = ยอดสั่งรวม - จำนวนที่ขาด
      const availableBySku = {}
      viProductSummary.forEach(row => {
        const shortQty = shortageBySku[row.sku] || 0
        availableBySku[row.sku] = row.totalQty - shortQty
      })

      const sortedOrdersAsc = [...orders].sort((a, b) => a.id - b.id)

      // เก็บรายการขาดแยกตาม Order: { orderId, customerName, items: [{ name, sku, unit, missingQty }] }
      const orderShortageList = []

      sortedOrdersAsc.forEach(order => {
        if (!order.order_items || order.order_items.length === 0) return

        const missingInThisOrder = []

        order.order_items.forEach(item => {
          const sku = item.product_sku
          const requestedQty = Number(item.quantity) || 0
          const availableQty = availableBySku[sku] ?? requestedQty

          // จัดสรรของที่มีให้ Order ที่มาก่อน
          const allocatedQty = Math.min(requestedQty, Math.max(0, availableQty))
          availableBySku[sku] = Math.max(0, availableQty - allocatedQty)

          const missingQty = requestedQty - allocatedQty
          if (missingQty > 0) {
            const productInfo = products.find(p => p.sku === sku)
            missingInThisOrder.push({
              sku,
              name: item.product_name,
              unit: productInfo ? productInfo.unit : 'หน่วย',
              missingQty
            })
          }
        })

        if (missingInThisOrder.length > 0) {
          orderShortageList.push({
            orderId: order.id,
            customerName: order.customer_name,
            items: missingInThisOrder
          })
        }
      })

      // สร้างข้อความสำหรับ Copy ส่งแจ้งลูกค้า
      let msgText = `🌱 ฟาร์มเป็นธรรม - แจ้งรายการสินค้าที่ขาด\n`
      msgText += `------------------------------------\n`
      orderShortageList.forEach(entry => {
        msgText += `🧾 Order #${entry.orderId} | ลูกค้า: ${entry.customerName}\n`
        entry.items.forEach((m, idx) => {
          msgText += `   ${idx + 1}. ${m.name} (${m.sku}) ขาด ${m.missingQty} ${m.unit}\n`
        })
        msgText += `------------------------------------\n`
      })
      msgText += `🙏 ขออภัยในความไม่สะดวกครับ แอดมินกำลังประสานงานแจ้งลูกค้าครับ`

      setViResult({ text: msgText })
    } catch (error) {
      setMessage('❌ ยืนยัน VI ไม่สำเร็จ: ' + error.message)
    } finally {
      setConfirmingVi(false)
    }
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
    <div style={{ padding: '16px', fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto', color: '#222' }}>
      <h1 style={{ marginBottom: '12px' }}>🌱 ฟาร์มเป็นธรรม</h1>

      {/* แถบเมนูหลัก */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '2px solid #e0e0e0', paddingBottom: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => { setActiveTab('order'); setMessage(''); setEditingOrder(null); setFulfillmentMode('list'); setViResult(null) }}
          style={{
            padding: '10px 16px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '14px',
            background: activeTab === 'order' ? '#2e7d32' : '#eeeeee',
            color: activeTab === 'order' ? '#ffffff' : '#333333'
          }}
        >
          📝 บันทึกคำสั่งซื้อ
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('manage_orders'); setMessage(''); setEditingOrder(null); setViResult(null); fetchOrders() }}
          style={{
            padding: '10px 16px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '14px',
            background: activeTab === 'manage_orders' ? '#e65100' : '#eeeeee',
            color: activeTab === 'manage_orders' ? '#ffffff' : '#333333'
          }}
        >
          📋 จัดการคำสั่งซื้อ ({orders.length})
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('product'); setMessage(''); setEditingOrder(null); setFulfillmentMode('list'); setViResult(null) }}
          style={{
            padding: '10px 16px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '14px',
            background: activeTab === 'product' ? '#1565c0' : '#eeeeee',
            color: activeTab === 'product' ? '#ffffff' : '#333333'
          }}
        >
          📦 จัดการสินค้า (Product)
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('customer'); setMessage(''); setEditingOrder(null); setFulfillmentMode('list'); setViResult(null) }}
          style={{
            padding: '10px 16px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '14px',
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
      {/* TAB 1: บันทึกคำสั่งซื้อใหม่                                             */}
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

              <div style={{ background: '#e8f5e9', padding: '15px', borderRadius: '6px', marginBottom: '20px' }}>
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
              <div style={{ marginBottom: '16px' }}>
                <textarea
                  readOnly
                  value={completedOrderText}
                  rows="12"
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
                    alert('📋 คัดลอกข้อความเรียบร้อยแล้ว!')
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
      {/* TAB 2: จัดการคำสั่งซื้อ (Top VI/VO/PI/PA + Order List + Edit Order)   */}
      {/* ===================================================================== */}
      {activeTab === 'manage_orders' && (
        <div>
          {/* แถบปุ่ม VI VO PI PA ด้านบนของข้อมูล */}
          <div style={{ background: '#fafafa', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'bold', marginRight: '4px' }}>ขั้นตอนงาน:</span>
            {['VI', 'VO', 'PI', 'PA'].map((step) => {
              const isSelected = fulfillmentMode === step
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => handleSelectFulfillmentMode(step)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    background: isSelected ? '#2e7d32' : '#d32f2f',
                    color: '#ffffff'
                  }}
                >
                  {step}
                </button>
              )
            })}
            {fulfillmentMode !== 'list' && (
              <button
                type="button"
                onClick={() => { setFulfillmentMode('list'); setViResult(null) }}
                style={{
                  marginLeft: 'auto',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  border: '1px solid #bbb',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '13px',
                  background: '#ffffff',
                  color: '#333333'
                }}
              >
                ↩ กลับหน้ารวมคำสั่งซื้อ
              </button>
            )}
          </div>

          {/* โหมด VI: รวมสินค้าของทุก Order + กรอกของที่ขาด + ยืนยัน */}
          {fulfillmentMode === 'VI' && (
            <div style={{ background: '#fffde7', padding: '20px', borderRadius: '8px', border: '2px solid #fbc02d', marginBottom: '20px' }}>
              <h2 style={{ marginTop: 0 }}>📦 VI: ตรวจสอบยอดสินค้ารวมทุก Order</h2>

              {viResult === 'ready' ? (
                <div style={{ background: '#e8f5e9', padding: '24px', borderRadius: '8px', border: '2px solid #2e7d32', textAlign: 'center' }}>
                  <h2 style={{ marginTop: 0, color: '#2e7d32', fontSize: '24px' }}>✅ สินค้าพร้อมส่ง</h2>
                  <p style={{ marginBottom: '16px' }}>ไม่มีรายการสินค้าที่ขาด ระบบบันทึกสถานะ VI เรียบร้อยแล้วครับ</p>
                  <button
                    type="button"
                    onClick={() => { setViResult(null); setFulfillmentMode('list') }}
                    style={{ background: '#2e7d32', color: '#ffffff', padding: '10px 20px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}
                  >
                    กลับไปหน้ารวมคำสั่งซื้อ
                  </button>
                </div>
              ) : viResult && viResult.text ? (
                <div style={{ background: '#ffffff', padding: '18px', borderRadius: '8px', border: '1px solid #ccc' }}>
                  <h3 style={{ marginTop: 0, color: '#c62828' }}>⚠️ พบรายการสินค้าที่ขาด (จัดสรรของให้ Order ที่สั่งก่อนตามลำดับ)</h3>
                  <textarea
                    readOnly
                    value={viResult.text}
                    rows="12"
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '15px',
                      fontFamily: 'monospace',
                      borderRadius: '6px',
                      border: '1px solid #ccc',
                      boxSizing: 'border-box',
                      background: '#ffffff',
                      color: '#222222',
                      marginBottom: '12px'
                    }}
                  />
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(viResult.text)
                        alert('📋 คัดลอกข้อความแจ้งสินค้าที่ขาดเรียบร้อยแล้ว!')
                      }}
                      style={{ background: '#00c300', color: '#ffffff', padding: '11px 20px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px', flex: 1 }}
                    >
                      📋 คัดลอกข้อความ
                    </button>
                    <button
                      type="button"
                      onClick={() => setViResult(null)}
                      style={{ background: '#757575', color: '#ffffff', padding: '11px 18px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}
                    >
                      แก้ไขตัวเลขของที่ขาด
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleConfirmViCheck}>
                  <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                    <table border="1" cellPadding="8" style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                      <thead>
                        <tr style={{ background: '#fff9c4' }}>
                          <th>SKU</th>
                          <th>ชื่อสินค้า</th>
                          <th>หน่วย</th>
                          <th>จำนวนรวมทุก Order</th>
                          <th style={{ width: '150px' }}>จำนวนสินค้าที่ขาด</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viProductSummary.length === 0 ? (
                          <tr><td colSpan="5" style={{ textAlign: 'center', padding: '16px' }}>ไม่มีรายการสินค้าใน Order</td></tr>
                        ) : (
                          viProductSummary.map((row) => (
                            <tr key={row.sku}>
                              <td>{row.sku}</td>
                              <td style={{ fontWeight: 'bold' }}>{row.name}</td>
                              <td style={{ textAlign: 'center' }}>{row.unit}</td>
                              <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{row.totalQty}</td>
                              <td style={{ textAlign: 'center' }}>
                                <input
                                  type="number"
                                  min="0"
                                  max={row.totalQty}
                                  value={shortageInputs[row.sku] ?? ''}
                                  onChange={(e) =>
                                    setShortageInputs(prev => ({ ...prev, [row.sku]: e.target.value }))
                                  }
                                  placeholder="0"
                                  style={{ width: '80px', padding: '6px', textAlign: 'center', fontSize: '15px' }}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <button
                    type="submit"
                    disabled={confirmingVi || viProductSummary.length === 0}
                    style={{ background: '#2e7d32', color: '#ffffff', padding: '12px 24px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', width: '100%' }}
                  >
                    {confirmingVi ? 'กำลังประมวลผล...' : '✅ ยืนยันผลตรวจสอบ VI'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* โหมด VO / PI / PA (เตรียมพื้นที่รองรับการกดปุ่มด้านบน) */}
          {(fulfillmentMode === 'VO' || fulfillmentMode === 'PI' || fulfillmentMode === 'PA') && (
            <div style={{ background: '#f5f5f5', padding: '16px', borderRadius: '8px', border: '1px solid #ccc', marginBottom: '20px' }}>
              <h3 style={{ marginTop: 0 }}>โหมด {fulfillmentMode}</h3>
              <p style={{ margin: 0, color: '#555' }}>พร้อมรับรายละเอียดขั้นตอน {fulfillmentMode} ต่อจากนี้ครับพี่โย</p>
            </div>
          )}

          {/* หน้าจอแก้ไขบิล */}
          {editingOrder ? (
            <div style={{ background: '#fff3e0', padding: '20px', borderRadius: '8px', border: '2px solid #ef6c00', marginBottom: '24px' }}>
              <h2 style={{ marginTop: 0, color: '#e65100' }}>✏️ แก้ไขคำสั่งซื้อ บิล #{editingOrder.id}</h2>
              <form onSubmit={handleSaveEditedOrder}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>ชื่อลูกค้า:</label>
                  <input
                    type="text"
                    value={editOrderCustomer}
                    onChange={(e) => setEditOrderCustomer(e.target.value)}
                    style={{ width: '100%', padding: '10px', boxSizing: 'border-box', fontSize: '16px' }}
                  />
                </div>

                <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                  <table border="1" cellPadding="8" style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                    <thead>
                      <tr style={{ background: '#ffe0b2' }}>
                        <th>SKU</th>
                        <th>ชื่อสินค้า</th>
                        <th>ราคา (บาท)</th>
                        <th style={{ width: '100px' }}>จำนวนใหม่</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p) => (
                        <tr key={p.sku}>
                          <td>{p.sku}</td>
                          <td>{p.name}</td>
                          <td style={{ textAlign: 'right' }}>{Number(p.selling_price).toLocaleString()}</td>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="number"
                              min="0"
                              value={editOrderQuantities[p.sku] ?? ''}
                              onChange={(e) =>
                                setEditOrderQuantities(prev => ({ ...prev, [p.sku]: e.target.value }))
                              }
                              placeholder="0"
                              style={{ width: '65px', padding: '6px', textAlign: 'center', fontSize: '15px' }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="submit"
                    disabled={savingEditOrder}
                    style={{ background: '#2e7d32', color: 'white', padding: '12px 24px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', flex: 1 }}
                  >
                    {savingEditOrder ? 'กำลังบันทึก...' : '💾 บันทึกการแก้ไขบิล'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingOrder(null)}
                    style={{ background: '#757575', color: 'white', padding: '12px 24px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
                  >
                    ยกเลิก
                  </button>
                </div>
              </form>
            </div>
          ) : (
            fulfillmentMode === 'list' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="🔍 ค้นหาจากเลขบิล หรือ ชื่อลูกค้า..."
                    style={{ padding: '9px', width: '280px', maxWidth: '100%', fontSize: '15px' }}
                  />
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table border="1" cellPadding="8" style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                    <thead>
                      <tr style={{ background: '#fff3e0' }}>
                        <th>บิล #</th>
                        <th>วันที่สั่ง</th>
                        <th>ลูกค้า</th>
                        <th>รายการสินค้า</th>
                        <th>ยอดรวม</th>
                        <th>จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.length === 0 ? (
                        <tr><td colSpan="6" style={{ textAlign: 'center', padding: '16px' }}>ยังไม่มีรายการคำสั่งซื้อ</td></tr>
                      ) : (
                        filteredOrders.map((o) => (
                          <tr key={o.id}>
                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>#{o.id}</td>
                            <td style={{ fontSize: '13px' }}>
                              {o.created_at ? new Date(o.created_at).toLocaleDateString('th-TH') : '-'}
                            </td>
                            <td style={{ fontWeight: 'bold' }}>{o.customer_name}</td>
                            <td style={{ fontSize: '13px' }}>
                              {o.order_items && o.order_items.length > 0 ? (
                                <ul style={{ margin: 0, paddingLeft: '16px' }}>
                                  {o.order_items.map((item, idx) => (
                                    <li key={idx}>{item.product_name} x {item.quantity}</li>
                                  ))}
                                </ul>
                              ) : '-'}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#2e7d32' }}>
                              {Number(o.total_amount).toLocaleString()}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => handleStartEditOrder(o)}
                                style={{ background: '#ffa000', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                              >
                                ✏️ แก้ไขบิล
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: จัดการสินค้า (Product)                                          */}
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
      {/* TAB 4: จัดการลูกค้า (Customer)                                         */}
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