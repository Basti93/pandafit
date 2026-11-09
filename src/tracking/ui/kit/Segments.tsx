import { Icon, type IconName } from './Icon';

/** The one switch between sub pages: a pill with segments, the pressed one marked with aria-pressed. */
export function Segments<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string; icon?: IconName }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tk-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={20} />}{o.label}
        </button>
      ))}
    </div>
  );
}
