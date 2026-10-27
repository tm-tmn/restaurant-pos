import { useToast } from '../store/toast';
import { cn } from './ui';

export function Toast() {
  const { message, kind, hide } = useToast();
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <button
        onClick={hide}
        role="status"
        className={cn(
          'pointer-events-auto max-w-md rounded-xl px-4 py-3 text-left text-white shadow-lg',
          kind === 'error' ? 'bg-red-600' : 'bg-stone-900',
        )}
      >
        {message}
      </button>
    </div>
  );
}
