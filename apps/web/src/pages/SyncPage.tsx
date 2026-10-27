import { useEffect, useState } from 'react';
import { Button, Card, Empty } from '../components/ui';
import { baht } from '../lib/money';
import { discardFailed, flushQueue, listFailed, retryFailed, useSync, type FailedOrder } from '../lib/offline';
import { isManager, useAuth } from '../store/auth';

/** บิลที่ขายตอนออฟไลน์แล้วเซิร์ฟเวอร์ปฏิเสธ — ให้ผู้จัดการตรวจและตัดสินใจ */
export function SyncPage() {
  const { pending, failed, syncing } = useSync();
  const role = useAuth((s) => s.user?.role);
  const [rows, setRows] = useState<FailedOrder[]>([]);
  const reload = () => listFailed().then(setRows);
  useEffect(() => {
    void reload();
  }, [failed]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">การซิงค์บิลออฟไลน์</h1>
      <Card className="flex items-center gap-3 p-4">
        <div className="flex-1">รอส่ง {pending} บิล</div>
        <Button variant="outline" disabled={syncing || pending === 0} onClick={() => void flushQueue()}>
          {syncing ? 'กำลังส่ง…' : 'ส่งตอนนี้'}
        </Button>
      </Card>
      <h2 className="font-semibold">บิลที่เซิร์ฟเวอร์ไม่รับ ({rows.length})</h2>
      {rows.length === 0 ? (
        <Empty>ไม่มี</Empty>
      ) : (
        rows.map((f) => {
          const total = f.payload.payments.reduce((s, p) => s + p.amountSatang, 0);
          return (
            <Card key={f.payload.clientId} className="space-y-2 p-4">
              <div className="flex justify-between">
                <span className="font-medium">{new Date(f.payload.occurredAt).toLocaleString('th-TH')}</span>
                <span className="font-semibold tabular">{baht(total)}</span>
              </div>
              <div className="text-sm text-stone-600">{f.payload.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
              <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{f.lastError}</div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => retryFailed(f.payload.clientId).then(reload)}>
                  ลองส่งใหม่
                </Button>
                {isManager(role) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() => {
                      if (confirm('ลบบิลนี้ออกจากเครื่อง? ข้อมูลจะหายถาวร')) void discardFailed(f.payload.clientId).then(reload);
                    }}
                  >
                    ลบทิ้ง
                  </Button>
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
