export function EmptyState({ text, emoji = '📭' }: { text: string; emoji?: string }) {
  return (
    <div className="empty">
      <div className="empty-emoji">{emoji}</div>
      <p>{text}</p>
    </div>
  );
}
