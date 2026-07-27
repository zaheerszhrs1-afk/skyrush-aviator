export function Plane() {
  return (
    <svg className="plane" viewBox="0 0 320 170" role="img" aria-label="Flying plane">
      <g className="plane-tilt">
        <ellipse className="plane-shadow" cx="126" cy="136" rx="98" ry="16" />

        <g className="speed-lines">
          <path d="M10 97h52" />
          <path d="M32 116h64" />
          <path d="M56 76h48" />
        </g>

        <g className="smoke-trail">
          <circle cx="46" cy="103" r="8" />
          <circle cx="27" cy="108" r="14" />
          <circle cx="5" cy="115" r="20" />
        </g>

        <g className="plane-core">
          <path
            className="wing-back"
            d="M134 80 76 55c-9-4-17 2-15 10l9 30c2 7 10 11 17 8l62-18z"
          />
          <path
            className="wing-front"
            d="M164 97 96 119c-11 4-11 18-1 21l56 14c11 3 22-2 27-12l18-39z"
          />

          <path
            className="tail-wing"
            d="M88 82 42 62c-7-3-13 4-10 11l7 18c3 7 10 10 17 8l38-11z"
          />
          <path
            className="tail-fin"
            d="M92 76 77 29c-3-10 8-19 17-13l25 17c5 3 8 9 8 15v22z"
          />

          <path
            className="fuselage"
            d="M82 94c0-13 10-24 24-26l116-17c24-4 47 8 60 28l8 13c7 11 7 25 0 36l-8 12c-12 20-36 31-59 28l-118-16c-13-2-23-13-23-27V94z"
          />
          <path
            className="fuselage-highlight"
            d="M104 82c34-8 103-20 145-10 12 3 24 11 31 21-11-8-26-13-41-11l-135 12z"
          />

          <path
            className="cockpit"
            d="M178 68c17-6 33 0 43 13 2 3 2 7-1 9l-38 22c-5 3-11-1-11-7V78c0-4 3-8 7-10z"
          />
          <path className="cockpit-gloss" d="M185 76c8-3 18-1 25 6l-24 14c-3 2-7 0-7-4V80c0-2 2-4 6-4z" />

          <circle className="front-cap" cx="287" cy="108" r="20" />
          <circle className="nose-core" cx="287" cy="108" r="10" />

          <g className="propeller" transform="translate(287 108)">
            <rect x="-4" y="-48" width="8" height="96" rx="4" />
            <rect x="-48" y="-4" width="96" height="8" rx="4" />
            <rect x="-34" y="-34" width="68" height="8" rx="4" transform="rotate(45)" />
            <rect x="-34" y="-34" width="68" height="8" rx="4" transform="rotate(-45)" />
          </g>

          <g className="rivets">
            <circle cx="118" cy="99" r="2.3" />
            <circle cx="145" cy="96" r="2.3" />
            <circle cx="171" cy="94" r="2.3" />
            <circle cx="198" cy="95" r="2.3" />
            <circle cx="226" cy="99" r="2.3" />
          </g>

          <path className="skid-line" d="M130 137c33 7 73 9 111 6" />
        </g>
      </g>
    </svg>
  );
}
