// src/ui/ConsequenceChecklist.tsx
// The explicit-acceptance checklist every text-changing preview shares
// (Reprocessing #63/#64, PDF repair, and the reader's corrections dialog,
// spec #68 #72): one checkbox per chapter consequence, so nothing that
// loses its chapter meaning is applied without the reader ticking it.

/** Each consequence is accepted explicitly; apply stays disabled until all
 * are. */
export function ConsequenceChecklist({
  items,
  accepted,
  onChange,
  disabled,
}: {
  items: readonly { label: string }[];
  accepted: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
  disabled: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <h3>Reader data that cannot keep its chapter meaning</h3>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <label>
              <input
                type="checkbox"
                checked={accepted.has(index)}
                disabled={disabled}
                onChange={(event) => {
                  const next = new Set(accepted);
                  if (event.target.checked) next.add(index);
                  else next.delete(index);
                  onChange(next);
                }}
              />
              {item.label}
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}
