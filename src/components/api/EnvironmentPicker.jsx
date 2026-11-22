import { useId } from 'react'
import { Settings2 } from 'lucide-react'

/** The API Tester's environment selector, as on the HTTP side: {{variables}} come from the chosen one. */
export default function EnvironmentPicker({ envs, activeId, onSelect, onManage, compact }) {
    const id = useId()
    return (
        <div className="api-rt-env">
            <label htmlFor={id} className="field-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>
                {compact ? 'Env' : 'Environment'}
            </label>
            <select
                id={id}
                value={activeId}
                onChange={e => onSelect(e.target.value)}
                style={{ width: 'auto', maxWidth: compact ? 150 : 220, padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
            >
                {envs.map(e => <option key={e.id} value={e.id}>{e.name} ({e.vars.length} var{e.vars.length === 1 ? '' : 's'})</option>)}
            </select>
            <button type="button" className="icon-btn" onClick={onManage} aria-label="Manage environments" title="Manage environments">
                <Settings2 size={16} aria-hidden="true" />
            </button>
        </div>
    )
}
