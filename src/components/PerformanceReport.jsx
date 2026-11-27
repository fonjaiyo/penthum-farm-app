import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabase';

const formatCurrency = (num) => {
  return Number(num || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const getMonthBounds = (ym) => {
  const [year, month] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${ym}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
};

export default function PerformanceReport() {
  const today = new Date();
  const defaultYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  const [filterMode, setFilterMode] = useState('month'); // 'month' | 'range'
  const [selectedMonth, setSelectedMonth] = useState(defaultYm);
  const [startDate, setStartDate] = useState(getMonthBounds(defaultYm).start);
  const [endDate, setEndDate] = useState(getMonthBounds(defaultYm).end);

  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [accountsMap, setAccountsMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [expandedCode, setExpandedCode] = useState(null);

  useEffect(() => {
    if (filterMode === 'month' && selectedMonth) {
      const { start, end } = getMonthBounds(selectedMonth);
      setStartDate(start);
      setEndDate(end);
    }
  }, [filterMode, selectedMonth]);

  useEffect(() => {
    const fetchAccounts = async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('code, name, account_type');
      if (!error && data) {
        const map = {};
        data.forEach((acc) => {
          map[acc.code] = acc;
        });
        setAccountsMap(map);
      }
    };
    fetchAccounts();
  }, []);

  const fetchReportData = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setErrorMsg('');
    setExpandedCode(null);

    try {
      const startIso = `${startDate}T00:00:00+07:00`;
      const endIso = `${endDate}T23:59:59.999+07:00`;

      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .select('*')
        .gte('order_date', startIso)
        .lte('order_date', endIso);

      if (orderErr) throw orderErr;

      const { data: expenseData, error: expErr } = await supabase
        .from('expenses')
        .select('*')
        .gte('slip_date', startDate)
        .lte('slip_date', endDate)
        .order('slip_date', { ascending: false });

      if (expErr) throw expErr;

      setOrders(orderData || []);
      setExpenses(expenseData || []);
    } catch (err) {
      console.error('Error loading performance report:', err);
      setErrorMsg(err.message || 'ไม่สามารถโหลดข้อมูลรายงานได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [startDate, endDate]);

  const summary = useMemo(() => {
    const validOrders = orders.filter(
      (o) =>
        o.is_cancelled !== true &&
        !['cancelled', 'canceled', 'ยกเลิก'].includes((o.status || '').toLowerCase())
    );

    const totalSales = validOrders.reduce(
      (sum, o) => sum + Number(o.total_amount ?? 0),
      0
    );

    const reviewedExpenses = expenses.filter((e) => e.status === 'reviewed');
    const pendingExpenses = expenses.filter((e) => e.status !== 'reviewed');
    const pendingTotal = pendingExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    let purchase51xx = 0;
    let opex52xx = 0;
    let capex12xx = 0;
    let otherExpenses = 0;

    const groupedByAccount = {};

    reviewedExpenses.forEach((item) => {
      const code = item.account_code || 'UNASSIGNED';
      const amt = Number(item.amount || 0);

      if (code.startsWith('51')) {
        purchase51xx += amt;
      } else if (code.startsWith('52') || code.startsWith('5')) {
        opex52xx += amt;
      } else if (code.startsWith('12') || code.startsWith('1')) {
        capex12xx += amt;
      } else {
        otherExpenses += amt;
      }

      if (!groupedByAccount[code]) {
        const accInfo = accountsMap[code];
        groupedByAccount[code] = {
          code,
          name: accInfo?.name || item.category || 'ไม่ระบุหมวดบัญชี',
          total: 0,
          count: 0,
          items: [],
        };
      }
      groupedByAccount[code].total += amt;
      groupedByAccount[code].count += 1;
      groupedByAccount[code].items.push(item);
    });

    const totalOperatingCost = purchase51xx + opex52xx + otherExpenses;
    const operatingProfit = totalSales - totalOperatingCost;
    const profitMargin = totalSales > 0 ? (operatingProfit / totalSales) * 100 : 0;

    const accountList = Object.values(groupedByAccount).sort((a, b) =>
      a.code.localeCompare(b.code)
    );

    return {
      orderCount: validOrders.length,
      totalSales,
      purchase51xx,
      opex52xx,
      capex12xx,
      otherExpenses,
      operatingProfit,
      profitMargin,
      pendingCount: pendingExpenses.length,
      pendingTotal,
      accountList,
    };
  }, [orders, expenses, accountsMap]);

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '16px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#1b4332' }}>📈 สรุปผลการดำเนินงาน & กำไรเบื้องต้น</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#555' }}>
            ภาพรวมยอดขาย หักยอดซื้อวัตถุดิบ (51xx) และค่าใช้จ่ายดำเนินงาน (52xx)
          </p>
        </div>
        <button
          onClick={fetchReportData}
          disabled={loading}
          style={{
            padding: '8px 14px',
            backgroundColor: '#2d6a4f',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          {loading ? 'กำลังโหลด...' : '🔄 รีเฟรชข้อมูล'}
        </button>
      </div>

      <div style={{ backgroundColor: '#f8f9fa', padding: '12px 16px', borderRadius: '8px', border: '1px solid #dee2e6', marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => setFilterMode('month')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #2d6a4f',
              backgroundColor: filterMode === 'month' ? '#2d6a4f' : '#fff',
              color: filterMode === 'month' ? '#fff' : '#2d6a4f',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            ดูรายเดือน
          </button>
          <button
            onClick={() => setFilterMode('range')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #2d6a4f',
              backgroundColor: filterMode === 'range' ? '#2d6a4f' : '#fff',
              color: filterMode === 'range' ? '#fff' : '#2d6a4f',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            กำหนดช่วงวันที่ (รอบเคลียร์)
          </button>
        </div>

        {filterMode === 'month' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '14px', fontWeight: 'bold' }}>เลือกเดือน:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #ccc' }}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '14px' }}>ตั้งแต่:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #ccc' }}
            />
            <label style={{ fontSize: '14px' }}>ถึง:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #ccc' }}
            />
          </div>
        )}

        <span style={{ fontSize: '13px', color: '#666', marginLeft: 'auto' }}>
          ช่วงข้อมูล: <strong>{startDate}</strong> ถึง <strong>{endDate}</strong>
        </span>
      </div>

      {errorMsg && (
        <div style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
          ⚠️ เกิดข้อผิดพลาด: {errorMsg}
        </div>
      )}

      {summary.pendingCount > 0 && (
        <div style={{ backgroundColor: '#fff3cd', border: '1px solid #ffeeba', color: '#856404', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', fontSize: '14px' }}>
          ⏳ <strong>แจ้งเตือน:</strong> ในช่วงวันที่นี้ยังมีรายจ่ายรอตรวจสอบ (<code>pending_review</code>) อยู่ <strong>{summary.pendingCount} รายการ</strong> (รวม <strong>{formatCurrency(summary.pendingTotal)} บาท</strong>) ซึ่งยังไม่ถูกนำมาคำนวณในยอดด้านล่าง
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div style={{ backgroundColor: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: '10px', padding: '16px' }}>
          <div style={{ fontSize: '13px', color: '#2e7d32', fontWeight: 'bold' }}>💰 ยอดขายรวม ({summary.orderCount} ออเดอร์)</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#1b5e20', marginTop: '6px' }}>
            {formatCurrency(summary.totalSales)} ฿
          </div>
        </div>

        <div style={{ backgroundColor: '#fff8e1', border: '1px solid #ffecb3', borderRadius: '10px', padding: '16px' }}>
          <div style={{ fontSize: '13px', color: '#f57f17', fontWeight: 'bold' }}>🥬 ยอดซื้อวัตถุดิบ/ผลิต (51xx)</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#e65100', marginTop: '6px' }}>
            -{formatCurrency(summary.purchase51xx)} ฿
          </div>
        </div>

        <div style={{ backgroundColor: '#fce4ec', border: '1px solid #f8bbd0', borderRadius: '10px', padding: '16px' }}>
          <div style={{ fontSize: '13px', color: '#c2185b', fontWeight: 'bold' }}>🧾 ค่าใช้จ่ายดำเนินงาน (52xx)</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#880e4f', marginTop: '6px' }}>
            -{formatCurrency(summary.opex52xx)} ฿
          </div>
        </div>

        <div style={{
          backgroundColor: summary.operatingProfit >= 0 ? '#e3f2fd' : '#ffebee',
          border: `1px solid ${summary.operatingProfit >= 0 ? '#bbdefb' : '#ffcdd2'}`,
          borderRadius: '10px',
          padding: '16px',
        }}>
          <div style={{ fontSize: '13px', color: summary.operatingProfit >= 0 ? '#1565c0' : '#c62828', fontWeight: 'bold' }}>
            📊 กำไรจากการดำเนินงานเบื้องต้น
          </div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: summary.operatingProfit >= 0 ? '#0d47a1' : '#b71c1c', marginTop: '6px' }}>
            {summary.operatingProfit >= 0 ? '+' : ''}{formatCurrency(summary.operatingProfit)} ฿
          </div>
          <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>
            อัตรากำไร: <strong>{summary.profitMargin.toFixed(1)}%</strong>
          </div>
        </div>
      </div>

      <div style={{ backgroundColor: '#f3e5f5', border: '1px solid #e1bee7', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <strong style={{ color: '#6a1b9a', fontSize: '14px' }}>🏗️ เงินลงทุนสินทรัพย์ / ปรับปรุงฟาร์ม (หมวด 12xx):</strong>
          <span style={{ fontSize: '13px', color: '#555', marginLeft: '8px' }}>
            (แยกออกจากการคำนวณกำไรขายประจำวัน)
          </span>
        </div>
        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#4a148c' }}>
          {formatCurrency(summary.capex12xx)} ฿
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', border: '1px solid #dee2e6', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ backgroundColor: '#2d6a4f', color: '#fff', padding: '12px 16px', fontWeight: 'bold', fontSize: '15px' }}>
          📑 รายละเอียดรายจ่ายที่ตรวจแล้วแยกตามหมวดบัญชี (คลิกเพื่อดูรายการย่อย)
        </div>

        {summary.accountList.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#777' }}>
            ไม่มีรายการรายจ่ายที่ตรวจแล้ว (reviewed) ในช่วงวันที่เลือก
          </div>
        ) : (
          <div>
            {summary.accountList.map((acc) => {
              const isExpanded = expandedCode === acc.code;
              return (
                <div key={acc.code} style={{ borderBottom: '1px solid #eee' }}>
                  <div
                    onClick={() => setExpandedCode(isExpanded ? null : acc.code)}
                    style={{
                      padding: '12px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      backgroundColor: isExpanded ? '#f1f8f5' : '#fff',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 'bold', color: '#1b4332', marginRight: '8px' }}>
                        [{acc.code}]
                      </span>
                      <span style={{ fontWeight: 'bold' }}>{acc.name}</span>
                      <span style={{ fontSize: '12px', color: '#666', marginLeft: '8px' }}>
                        ({acc.count} รายการ)
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '15px' }}>
                        {formatCurrency(acc.total)} ฿
                      </span>
                      <span style={{ fontSize: '12px', color: '#666' }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ backgroundColor: '#fafafa', padding: '8px 16px 14px', borderTop: '1px dashed #ddd' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', color: '#555' }}>
                            <th style={{ padding: '6px' }}>วันที่</th>
                            <th style={{ padding: '6px' }}>ช่องทาง</th>
                            <th style={{ padding: '6px' }}>รายการ / บันทึกช่วยจำ</th>
                            <th style={{ padding: '6px' }}>ผู้รับ / ร้านค้า</th>
                            <th style={{ padding: '6px', textAlign: 'right' }}>จำนวนเงิน</th>
                          </tr>
                        </thead>
                        <tbody>
                          {acc.items.map((row) => (
                            <tr key={row.id} style={{ borderBottom: '1px solid #eee' }}>
                              <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>{row.slip_date}</td>
                              <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>
                                {row.payment_method === 'cash' ? '💵 เงินสด' : '🏦 โอน'}
                              </td>
                              <td style={{ padding: '6px' }}>
                                {row.memo || '-'}
                                {row.notes ? <span style={{ color: '#666' }}> ({row.notes})</span> : null}
                              </td>
                              <td style={{ padding: '6px' }}>{row.receiver_name || '-'}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>
                                {formatCurrency(row.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}