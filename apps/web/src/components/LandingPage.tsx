import { useState } from "react";

interface LandingPageProps {
  onLogin: () => void;
  onRegister: () => void;
}

const promos = [
  { code: "B9-DEMO", title: "Practice before you play", copy: "Use demo mode to learn the timing of every round.", action: "TRY DEMO" },
  { code: "VIP CLUB", title: "Rewards for regulars", copy: "Level-up bonuses, monthly rewards and a profile that keeps your history close.", action: "VIEW VIP" }
];

export function LandingPage({ onLogin, onRegister }: LandingPageProps) {
  const [darkMode, setDarkMode] = useState(true);

  return <main className={`landing-editorial${darkMode ? " is-dark" : ""}`}>
    <header className="editorial-header">
      <a className="editorial-brand" href="/" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}><img src="/b9t9-logo.webp" alt="B9T9" /><span>B9T9</span></a>
      <div className="editorial-header-meta"><span><i /> LIVE PLAY</span><b>PKR</b><button className="editorial-theme-toggle" type="button" aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={darkMode} onClick={() => setDarkMode((value) => !value)}>{darkMode ? "LIGHT" : "DARK"}</button><button onClick={onLogin}>SIGN IN</button><button className="editorial-join" onClick={onRegister}>JOIN B9T9</button></div>
    </header>

    <div className="editorial-ticker"><span>GAME 01</span><strong>AVIATOR</strong><span>ROUND OPEN</span><b>DEMO MODE AVAILABLE</b><em>BET RESPONSIBLY</em></div>

    <section className="editorial-hero">
      <div className="editorial-intro"><span className="editorial-label">B9T9 / CRASH GAME</span><h1>How far<br /><em>will you go?</em></h1><p>One round. One decision. Follow the flight and cash out while the multiplier is still climbing.</p><div className="editorial-actions"><button className="editorial-primary" onClick={onRegister}>CREATE ACCOUNT <span>↗</span></button><button className="editorial-text-button" onClick={onLogin}>ALREADY PLAYING? SIGN IN</button></div></div>
      <div className="editorial-gameboard" aria-label="B9T9 game preview">
        <div className="gameboard-top"><span><i /> LIVE ROUND</span><strong>2,512 PLAYERS</strong><b>HOUSE EDGE 1%</b></div>
        <div className="gameboard-stage"><div className="stage-scanline" /><div className="stage-axis axis-x" /><div className="stage-axis axis-y" /><div className="stage-label stage-label-top">3.00x</div><div className="stage-label stage-label-bottom">1.00x</div><div className="stage-multiplier"><small>CURRENT</small><strong>2.51<span>x</span></strong></div><div className="stage-route" /><img src="/aviator-plane.png" alt="" /><div className="stage-quote">“The edge is knowing when to leave.”</div></div>
        <div className="gameboard-bottom"><span>ROUND #B9T9-04721</span><span>PROVABLY FAIR <b>✓</b></span><span>FLIGHT STATUS <strong>IN AIR</strong></span></div>
      </div>
    </section>

    <section className="editorial-rule-stats" aria-label="B9T9 game facts"><div><b>01</b><span>PLACE A BET</span></div><div><b>02</b><span>WATCH THE FLIGHT</span></div><div><b>03</b><span>CASH OUT IN TIME</span></div><aside><strong>1.00x</strong><span>ROUND STARTS HERE</span></aside></section>

    <section className="editorial-content" id="promotions"><div className="editorial-section-title"><span className="editorial-label">PLAYER NOTES</span><h2>Built around<br /><em>the round.</em></h2><p>B9T9 keeps the important parts visible: your stake, the live multiplier and the moment you decide to cash out.</p></div><div className="editorial-feature-list"><article className="editorial-feature-main"><div><span className="editorial-label">01 / DEMO FLIGHT</span><h3>Find your timing<br />without the pressure.</h3><p>Start with demo balance, watch a few flights and get comfortable with the rhythm before using your real wallet.</p><button onClick={onRegister}>OPEN DEMO MODE <span>→</span></button></div><div className="feature-mark">B9<br /><i>T9</i></div></article><div className="editorial-feature-side">{promos.map((promo) => <article key={promo.code}><span>{promo.code}</span><h3>{promo.title}</h3><p>{promo.copy}</p><button onClick={onRegister}>{promo.action} <b>→</b></button></article>)}</div></div></section>

    <section className="editorial-content editorial-guide" id="how-it-works"><div className="editorial-guide-header"><span className="editorial-label">THE B9T9 METHOD</span><h2>Read the number.<br /><em>Make the call.</em></h2></div><div className="editorial-guide-steps"><article><b>01</b><div><h3>Choose your stake</h3><p>Select an amount that fits your plan. You can always begin in demo mode.</p></div></article><article><b>02</b><div><h3>Watch the multiplier</h3><p>The plane is moving and the number is live. Nothing is hidden behind a menu.</p></div></article><article><b>03</b><div><h3>Cash out</h3><p>Take the return when it feels right. The decision is always yours.</p></div></article></div></section>

    <section className="editorial-responsibility" id="security"><div><span className="editorial-label">CLEAR BY DESIGN</span><h2>No noise.<br />Just the round.</h2></div><div className="editorial-responsibility-copy"><p>Every B9T9 round is built to be read at a glance, with a provably fair result and a wallet history you can review.</p><div><span><b>✓</b> Provably fair</span><span><b>✓</b> Secure wallet</span><span><b>✓</b> Player support</span></div></div></section>

    <footer className="editorial-footer"><span>© 2026 B9T9 / PLAY RESPONSIBLY</span><div><button onClick={onLogin}>SIGN IN</button><button onClick={onRegister}>CREATE ACCOUNT</button></div></footer>
  </main>;
}
