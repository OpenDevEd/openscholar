// The approved Orbit artwork and gesture lengths, shared by the assistant and its preview.
export const orbitSeconds = { still: 0, idle: 8.4, listening: 6.4, thinking: 7.2, searching: 6.6, writing: 5.8, complete: 5.2 };
export const orbitShape = `<g class="body motion-part">
      <g class="layers">
        <path class="piece p1 a motion-part" d="M103 41C89 22 52 16 31 29C17 38 16 53 25 65C14 56 11 40 23 28C42 9 86 11 104 32C108 37 108 42 103 41Z"/>
        <path class="piece p2 c motion-part" d="M21 57C26 77 52 87 78 85C92 84 105 79 112 71C109 84 91 94 73 96C48 99 20 85 17 67C16 61 17 56 21 57Z"/>
        <path class="piece p3 b motion-part" d="M27 84C46 101 79 106 106 91C97 108 64 116 42 105C33 101 27 94 25 88C24 85 25 83 27 84Z"/>
      </g>
      <g class="face motion-part">
        <g class="normal-eyes motion-part"><rect class="eye eye-left motion-part" x="49" y="45" width="8" height="18" rx="4"/><rect class="eye eye-right motion-part" x="72" y="45" width="8" height="18" rx="4"/></g>
        <g class="smile motion-part"><path d="M48.5 54Q53 46.5 57.5 54M71.5 54Q76 46.5 80.5 54"/><path d="M60 68Q65 72 70 67.5" stroke-width="2.7"/></g>
      </g>
      <path class="accent-line ink-line motion-part" pathLength="1" d="M33 82C53 97 81 97 101 86"/>
    </g>
    <path class="accent-line listen-near motion-part" pathLength="1" d="M112 40Q121 49 113 59"/>
    <path class="accent-line listen-far motion-part" pathLength="1" d="M117 33Q130 49 119 65"/>
    <path class="accent-line scan-line motion-part" pathLength="1" d="M15 53C10 22 76 0 112 34"/>`;
