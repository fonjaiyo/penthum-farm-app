import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import './App.css'

export default function App() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  
  // State สำหรับฟอร์มสั่งซื้อ
  const [customerName, setCustomerName] = useState('')
  const [quantities, setQuantities] = useState({}) // เก็บจำนวนสินค้าแต่ละ SKU เช่น { 'BEV-001': 2, 'DUR-004': 1 }
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  // โหลดรายการสินค้าจาก Supabase เมื่อเปิดเว็บ
  useEffect(() => {
    fetchProducts()
  }, [])

  async function fetchProducts() {
    try {
      setLoading(true)
      const { data, error } = await supabase.from('products').select('*')
      if (error) throw error
      setProducts(data || [])
    } catch (error) {
      console.error('Error fetching products:', error.message)
    } finally {
      setLoading(false)
    }
  }

  // จัดการเมื่อพิมพ์เปลี่ยนจำนวนสินค้าแต่ละตัว
  function handleQuantityChange(sku, value) {
    setQuantities(prev => ({
      ...prev,
      [sku]: value
    }))
  }

  // คำนวณราคารวมทั้งหมด
  const totalOrderAmount = products.reduce((sum, p) => {
    const qty = Number(quantities[p.sku]) || 0
    return sum + (p.selling_price * qty)
  }, 0)

  // ฟังก์ชันบันทึกคำสั่งซื้อ
  async function handleCreateOrder(e) {
    e.preventDefault()
    if (!customerName.trim()) {
      setMessage('❌ กรุณากรอกชื่อลูกค้าก่อนบันทึกครับ')
      return
    }

    // กรองเฉพาะสินค้าที่มีการใส่จำนวนมากกว่า 0
    const orderedItems = products
      .map(p => ({
        product: p,
        qty: Number(quantities[p.sku]) || 0
      }))
      .filter(item => item.qty > 0)

    if (orderedItems.length === 0) {
      setMessage('❌ กรุณาใส่จำนวนสินค้าอย่างน้อย 1 รายการครับ')
      return
    }

    try {
      setSubmitting(true)
      setMessage('')

      // 1. บันทึกลงตาราง orders (หัวบิล)
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert([
          { 
            customer_name: customerName, 
            total_amount: totalOrderAmount,
            status: 'Pending' 
          }
        ])
        .select()

      if (orderError) throw orderError
      const newOrder = orderData[0]

      // 2. เตรียมข้อมูลรายการสินค้าสำหรับบันทึกลง order_items
      const itemsToInsert = orderedItems.map(item => ({
        order_id: newOrder.id,
        product_sku: item.product.sku,
        product_name: item.product.name,
        quantity: item.qty,
        price_unit: item.product.selling_price,
        subtotal: item.product.selling_price * item.qty
      }))

      const { error: itemError } = await supabase
        .from('order_items')
        .insert(itemsToInsert)

      if (itemError) throw itemError

      setMessage('✅ บันทึกคำสั่งซื้อสำเร็จเรียบร้อยแล้ว!')
      setCustomerName('')
      setQuantities({}) // เคลียร์จำนวน

    } catch (error) {
      console.error('Error saving order:', error.message)
      setMessage('❌ เกิดข้อผิดพลาด: ' + error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '900px', margin: '0 auto' }}>
      <h1>🌱 ฟาร์มเป็นธรรม - ระบบบันทึกคำสั่งซื้อ</h1>
      <p>เลือกสินค้าใส่จำนวนตามรายการด้านล่างได้ทันที</p>

      <form onSubmit={handleCreateOrder}>
        {/* ส่วนกรอกชื่อลูกค้า */}
        <div style={{ background: '#f5f5f5', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ddd' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>ชื่อลูกค้า / ผู้สั่งซื้อ:</label>
          <input 
            type="text" 
            value={customerName} 
            onChange={(e) => setCustomerName(e.target.value)} 
            placeholder="เช่น คุณจ๋าย หรือ พี่โย" 
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box', fontSize: '16px' }}
          />
        </div>

        {/* ส่วนตารางเลือกสินค้าและใส่จำนวน */}
        <h2>📦 รายการสินค้าทั้งหมด</h2>
        {loading ? (
          <p>กำลังโหลดข้อมูลสินค้า...</p>
        ) : (
          <table border="1" cellPadding="10" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', background: '#fff' }}>
            <thead>
              <tr style={{ background: '#e8f5e9' }}>
                <th>SKU</th>
                <th>ชื่อสินค้า</th>
                <th>หน่วย</th>
                <th>ราคาต่อหน่วย (บาท)</th>
                <th style={{ width: '120px' }}>จำนวนที่สั่ง</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.sku}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.unit}</td>
                  <td style={{ textAlign: 'right' }}>{p.selling_price.toLocaleString()}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input 
                      type="number" 
                      min="0"
                      value={quantities[p.sku] || ''} 
                      onChange={(e) => handleQuantityChange(p.sku, e.target.value)}
                      placeholder="0"
                      style={{ width: '70px', padding: '6px', textAlign: 'center', fontSize: '16px' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* สรุปยอดรวมและปุ่มบันทึก */}
        <div style={{ background: '#e3f2fd', padding: '20px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #bbdefb' }}>
          <div>
            <h3 style={{ margin: 0, color: '#0d47a1' }}>ยอดรวมทั้งสิ้น: {totalOrderAmount.toLocaleString()} บาท</h3>
          </div>
          <button 
            type="submit" 
            disabled={submitting}
            style={{ background: '#2e7d32', color: 'white', padding: '12px 25px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
          >
            {submitting ? 'กำลังบันทึก...' : '💾 บันทึกคำสั่งซื้อทั้งหมด'}
          </button>
        </div>
      </form>

      {message && <p style={{ marginTop: '15px', fontWeight: 'bold', fontSize: '16px' }}>{message}</p>}
    </div>
  )
}