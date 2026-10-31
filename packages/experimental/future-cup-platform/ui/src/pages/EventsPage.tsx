import { Input, Select } from 'antd'
import { useMemo, useState } from 'react'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { useProjectState } from '../state/ProjectStoreContext.tsx'

/** Render the ordered durable event stream with local filters. */
export function EventsPage() {
  const { dictionary, locale } = useLocale()
  const state = useProjectState()
  const [type, setType] = useState<string>()
  const [agent, setAgent] = useState<string>()
  const [search, setSearch] = useState('')
  const events = state.events
  const types = useMemo(() => [...new Set(events.map(event => event.type))].sort(), [events])
  const agents = useMemo(
    () => [...new Set(events.flatMap(event => event.agentId === undefined ? [] : [event.agentId]))].sort(),
    [events],
  )
  const filtered = useMemo(() => events.filter((event) => {
    if (type !== undefined && event.type !== type) return false
    if (agent !== undefined && event.agentId !== agent) return false
    if (search !== '' && !JSON.stringify(event).toLocaleLowerCase().includes(search.toLocaleLowerCase())) {
      return false
    }
    return true
  }), [events, type, agent, search])

  return (
    <div className="page-stack">
      <PageHeading title={dictionary.events.title} description={dictionary.events.description} />
      <div className="page-heading-actions">
        <Select
          allowClear
          style={{ minWidth: 190 }}
          placeholder={dictionary.events.filterType}
          value={type}
          onChange={setType}
          options={types.map(value => ({ value, label: value }))}
        />
        <Select
          allowClear
          style={{ minWidth: 170 }}
          placeholder={dictionary.events.filterAgent}
          value={agent}
          onChange={setAgent}
          options={agents.map(value => ({ value, label: value }))}
        />
        <Input.Search
          allowClear
          style={{ width: 260, maxWidth: '100%' }}
          value={search}
          onChange={(event) => { setSearch(event.target.value) }}
        />
      </div>
      {filtered.length === 0 ? <EmptyPanel text={dictionary.events.noEvents} /> : (
        <div className="event-list">
          {filtered.map(event => (
            <article className="event-row" key={event.seq}>
              <span className="event-seq">#{event.seq}</span>
              <span className="event-time">
                {new Intl.DateTimeFormat(locale, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                }).format(new Date(event.occurredAt))}
              </span>
              <span className="event-type">
                {event.type}
                {event.taskId === undefined ? null : <div className="event-time">{event.taskId}</div>}
                {event.agentId === undefined ? null : <div className="event-time">{event.agentId}</div>}
              </span>
              <pre className="event-payload">{JSON.stringify(event.payload, null, 2)}</pre>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
