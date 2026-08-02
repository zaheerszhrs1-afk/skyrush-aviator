interface LandingPageProps {
  onLogin: () => void;
  onRegister: () => void;
}

const highlights = [
  { value: "24/7", label: "Live game access" },
  { value: "1.00x", label: "Start every round" },
  { value: "PKR", label: "Fast wallet payouts" }
];

const promos = [
  { eyebrow: "WELCOME", title: "Start with a risk-free demo", body: "Learn the flight, test your timing and switch to real play when you are ready.", tone: "green" },
  { eyebrow: "VIP CLUB", title: "More action, more rewards", body: "Unlock level-up bonuses and a player profile built around your journey.", tone: "purple" },
  { eyebrow: "PLAY SMART", title: "Fair, visible and secure", body: "Track every round with provably fair results and clear wallet history.", tone: "orange" }
];

export function LandingPage({ onLogin, onRegister }: LandingPageProps) {
  return <main className="landing-page">
    <header className="landing-nav">
      <a className="landing-brand" href="/" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
        <img src="/b9t9-logo.webp" alt="B9T9" />
        <span><strong>B9T9</strong><small>FLY. PLAY. WIN.</small></span>
      </a>
      <nav aria-label="Landing page navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#promotions">Promotions</a>
        <a href="#security">Why B9T9</a>
      </nav>
      <div className="landing-nav-actions">
        <button className="landing-login" onClick={onLogin}>Sign in</button>
        <button className="landing-register" onClick={onRegister}>Join now</button>
      </div>
    </header>

    <section className="landing-hero">
      <div className="landing-hero-copy">
        <span className="landing-kicker"><i /> THE NEXT ROUND IS LIVE</span>
        <h1>Take your shot.<br /><em>Know when to fly.</em></h1>
        <p>Experience B9T9, the fast-paced crash game where timing meets instinct. Place your bet, watch the multiplier climb and cash out before the flight ends.</p>
        <div className="landing-hero-actions">
          <button className="landing-primary" onClick={onRegister}>Create free account <span>→</span></button>
          <button className="landing-secondary" onClick={onLogin}><span className="play-icon">▶</span> Sign in to play</button>
        </div>
        <div className="landing-trust-line"><span>✓ Secure wallet</span><span>✓ Provably fair</span><span>✓ Demo mode included</span></div>
      </div>

      <div className="landing-hero-art" aria-label="B9T9 flight preview">
        <div className="landing-art-orbit orbit-one" />
        <div className="landing-art-orbit orbit-two" />
        <div className="landing-art-grid" />
        <div className="landing-multiplier-card"><small>CURRENT MULTIPLIER</small><strong>2.51<span>x</span></strong><b><i /> LIVE ROUND</b></div>
        <img src="/aviator-plane.png" alt="" className="landing-plane" />
        <div className="landing-flight-line" />
        <div className="landing-art-badge badge-left"><small>ROUND</small><strong>#B9T9</strong></div>
        <div className="landing-art-badge badge-right"><small>PLAYERS</small><strong>2,512</strong></div>
      </div>
    </section>

    <section className="landing-highlights" aria-label="B9T9 highlights">
      {highlights.map((highlight) => <article key={highlight.label}><strong>{highlight.value}</strong><span>{highlight.label}</span></article>)}
    </section>

    <section className="landing-section landing-promos" id="promotions">
      <div className="landing-section-heading"><div><span className="landing-kicker">BUILT FOR THE BOLD</span><h2>One game. Endless possibilities.</h2></div><p>Everything you need for a better way to play, from your first demo flight to your next big round.</p></div>
      <div className="landing-promo-grid">{promos.map((promo, index) => <article className={`landing-promo-card ${promo.tone}`} key={promo.title}><div className="landing-promo-number">0{index + 1}</div><span>{promo.eyebrow}</span><h3>{promo.title}</h3><p>{promo.body}</p><button onClick={onRegister}>Explore <span>↗</span></button></article>)}</div>
    </section>

    <section className="landing-section landing-how" id="how-it-works">
      <div className="landing-how-card"><div className="landing-how-copy"><span className="landing-kicker">HOW IT WORKS</span><h2>Read the round.<br /><em>Make your move.</em></h2><p>Choose your stake, follow the multiplier and cash out while the plane is in the air. Every round is transparent, quick and made for your pace.</p><button className="landing-secondary" onClick={onRegister}>Open your game account <span>→</span></button></div><div className="landing-steps"><article><b>01</b><div><strong>Pick your stake</strong><span>Start in demo mode or use your real wallet.</span></div></article><article><b>02</b><div><strong>Watch it rise</strong><span>Every second changes the opportunity.</span></div></article><article><b>03</b><div><strong>Cash out in time</strong><span>Lock your return before the flight ends.</span></div></article></div></div>
    </section>

    <section className="landing-security" id="security">
      <div><span className="landing-kicker">PLAY WITH CONFIDENCE</span><h2>Your game, your pace, your rules.</h2></div>
      <div className="landing-security-items"><span><b>◆</b><strong>Provably fair rounds</strong><small>Verify every result</small></span><span><b>◈</b><strong>Protected wallet</strong><small>Clear deposits and withdrawals</small></span><span><b>✦</b><strong>Player-first support</strong><small>Help when you need it</small></span></div>
    </section>

    <footer className="landing-footer"><span>© 2026 B9T9. Play responsibly.</span><div><button onClick={onLogin}>Sign in</button><button onClick={onRegister}>Create account</button></div></footer>
  </main>;
}
