(() => {
  const STATE_KEY = 'harmonic-city-state-v2';
  const defaults = {
    orbitLabelFont: 'Inter',
    orbitLabelColor: '#fff8e9',
    orbitLabelSize: 11,
    orbitLabelWeight: '900',
    orbitLabelSpacing: 0.7,
    orbitLabelCase: 'uppercase'
  };

  const controls = {
    orbitLabelFont: document.getElementById('orbitLabelFont'),
    orbitLabelColor: document.getElementById('orbitLabelColor'),
    orbitLabelSize: document.getElementById('orbitLabelSize'),
    orbitLabelWeight: document.getElementById('orbitLabelWeight'),
    orbitLabelSpacing: document.getElementById('orbitLabelSpacing'),
    orbitLabelCase: document.getElementById('orbitLabelCase')
  };

  function readState() {
    try {
      return { ...defaults, ...(JSON.parse(localStorage.getItem(STATE_KEY)) || {}) };
    } catch {
      return { ...defaults };
    }
  }

  let state = readState();

  function apply() {
    const root = document.documentElement;
    root.style.setProperty('--orbit-label-font', `'${state.orbitLabelFont}'`);
    root.style.setProperty('--orbit-label-color', state.orbitLabelColor);
    root.style.setProperty('--orbit-label-size', `${state.orbitLabelSize}px`);
    root.style.setProperty('--orbit-label-weight', state.orbitLabelWeight);
    root.style.setProperty('--orbit-label-spacing', `${state.orbitLabelSpacing}px`);
    root.style.setProperty('--orbit-label-case', state.orbitLabelCase);

    Object.entries(controls).forEach(([key, input]) => {
      if (input && document.activeElement !== input) input.value = state[key];
    });
  }

  function save() {
    try {
      const current = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      localStorage.setItem(STATE_KEY, JSON.stringify({ ...current, ...state }));
      const status = document.getElementById('saveStatus');
      if (status) status.textContent = 'Saved automatically';
    } catch (error) {
      console.error('Could not save orbit label settings', error);
    }
  }

  Object.entries(controls).forEach(([key, input]) => {
    if (!input) return;
    input.addEventListener('input', () => {
      state[key] = input.type === 'range' ? Number(input.value) : input.value;
      apply();
      save();
    });
  });

  apply();

  window.addEventListener('storage', event => {
    if (event.key !== STATE_KEY) return;
    state = readState();
    apply();
  });
})();