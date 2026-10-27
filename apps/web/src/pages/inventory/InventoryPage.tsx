import { useSearchParams } from 'react-router-dom';
import { cn } from '../../components/ui';
import { HistoryTab, IngredientsTab, RecipesTab } from './CatalogTabs';
import { ConsumeTab, CountTab, ReceiveTab, TransferTab } from './OperationTabs';
import { StockTab } from './StockTab';

const TABS = [
  { id: 'stock', label: 'คงเหลือ', el: StockTab },
  { id: 'receive', label: 'รับเข้า', el: ReceiveTab },
  { id: 'consume', label: 'เบิก / ของเสีย', el: ConsumeTab },
  { id: 'transfer', label: 'โอนสาขา', el: TransferTab },
  { id: 'count', label: 'ตรวจนับ', el: CountTab },
  { id: 'recipes', label: 'สูตร & ต้นทุน', el: RecipesTab },
  { id: 'ingredients', label: 'วัตถุดิบ', el: IngredientsTab },
  { id: 'history', label: 'ประวัติ', el: HistoryTab },
] as const;

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0];
  const El = tab.el;
  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="mb-3 text-xl font-semibold">คลังวัตถุดิบ</h1>
      <div className="-mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex w-max gap-1 rounded-xl bg-stone-200 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              className={cn('rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap', tab.id === t.id ? 'bg-white shadow-sm' : 'text-stone-600 hover:text-stone-900')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <El />
    </div>
  );
}
