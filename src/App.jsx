import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import './App.css'

function App() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)

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

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>🌱 ฟาร์มเป็นธรรม - ระบบจัดการร้านค้า</h1>
      <p>เชื่อมต่อฐานข้อมูล Supabase สำเร็จเรียบร้อยแล้ว!</p>
      
      <h2>รายการสินค้า</h2>
      {loading ? (
        <p>กำลังโหลดข้อมูลสินค้า...</p>
      ) : products.length === 0 ? (
        <p>ยังไม่มีข้อมูลสินค้าในระบบ</p>
      ) : (
        <table border="1" cellPadding="10" style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <th>รหัสสินค้า</th>
              <th>ชื่อสินค้า</th>
              <th>ราคา</th>
            </tr>
          </thead>
          <tbody>
            {products.map((item) => (
              <tr key={item.id}>
                <td>{item.sku}</td>
                <td>{item.name}</td>
                <td>{item.selling_price} บาท</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default App