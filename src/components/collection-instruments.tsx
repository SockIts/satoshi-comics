export function CollectionInstruments({ count, loading }: { count: number; loading: boolean }) {
  return (
    <div className="collection-instruments">
      <svg className="collection-compass" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <radialGradient id="compass-paper"><stop stopColor="#e8dbb8" /><stop offset=".75" stopColor="#d4c09b" /><stop offset="1" stopColor="#a0835d" /></radialGradient>
          <linearGradient id="compass-brass" x2="1" y2="1"><stop stopColor="#dbc49c" /><stop offset=".5" stopColor="#8a6748" /><stop offset="1" stopColor="#caa47e" /></linearGradient>
        </defs>
        <circle cx="60" cy="60" r="56" fill="url(#compass-brass)" stroke="#382b21" strokeWidth="3" />
        <circle cx="60" cy="60" r="50" fill="none" stroke="#463b2c" strokeWidth="1.5" />
        <circle cx="60" cy="60" r="46" fill="url(#compass-paper)" stroke="#493c2b" strokeWidth="2" />
        {Array.from({ length: 40 }, (_, index) => <path key={index} d={`M60 17v${index % 5 === 0 ? 8 : 3}`} transform={`rotate(${index * 9} 60 60)`} stroke="#4b493b" strokeWidth={index % 5 === 0 ? 1.5 : .7} />)}
        <path d="M60 24 68 53 96 60 68 67 60 96 52 67 24 60 52 53Z" fill="#758075" stroke="#4f5042" />
        <path d="M60 24 60 60 68 53Z M60 60 96 60 68 67Z M60 60 60 96 52 67Z M60 60 24 60 52 53Z" fill="#eee3c7" />
        <g transform="rotate(33 60 60)"><path d="M60 22 65 60 60 68 55 60Z" fill="#aa493b" stroke="#46382c" /><path d="M60 98 65 60 60 52 55 60Z" fill="#e5d9bd" stroke="#46382c" /></g>
        <circle cx="60" cy="60" r="5" fill="#927555" stroke="#453729" />
        <g fill="#514938" fontFamily="Georgia, serif" fontSize="8" textAnchor="middle"><text x="60" y="35">N</text><text x="87" y="63">E</text><text x="60" y="91">S</text><text x="33" y="63">W</text></g>
      </svg>
      <div className="collection-count-plate" aria-label="Comics matching filters"><i /><output>{loading ? '…' : count}</output><i /></div>
      <div className="collection-lever" aria-hidden="true"><span /><i /></div>
    </div>
  )
}
