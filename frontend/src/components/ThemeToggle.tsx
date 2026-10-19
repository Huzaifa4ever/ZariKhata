import { useTheme, type ThemePreference } from '../theme/ThemeContext';
import { IconMonitor, IconMoon, IconSun } from './icons';

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof IconSun }> = [
  { value: 'light', label: 'Light', Icon: IconSun },
  { value: 'dark', label: 'Dark', Icon: IconMoon },
  { value: 'system', label: 'Match system', Icon: IconMonitor },
];

/** Three-way segmented control: light / dark / follow the OS. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          className={`theme-toggle-option${preference === value ? ' active' : ''}`}
          onClick={() => setPreference(value)}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
