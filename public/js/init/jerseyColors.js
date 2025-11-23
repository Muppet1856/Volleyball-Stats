// js/init/jerseyColors.js
function getContrastColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';  // black text on light jerseys, white on dark
}

export function createJerseySvg(color, number = '0') {
  const textColor = getContrastColor(color);
  return `
    <svg width="52" height="52" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 10l9-6h16l9 6 5 14-11 5v21H21V29l-11-5z"
            fill="${color}" stroke="#000" stroke-width="2"/>
      <text x="50%" y="40%" text-anchor="middle" fill="${textColor}"
            font-size="19" font-weight="bold" dominant-baseline="middle">${number}</text>
    </svg>
  `.trim();
}

export function enhanceJerseySelectsCustom() {
  document.querySelectorAll('.jersey-select').forEach(originalSelect => {
    const selectedOption = originalSelect.selectedOptions[0];
    const currentColor = selectedOption.dataset.color;
    const currentText = selectedOption.textContent.trim();

    // Create the visible button (looks exactly like form-select)
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'form-select d-flex align-items-center gap-2 pe-5 position-relative';
    button.dataset.bsToggle = 'dropdown';
    button.innerHTML = `
      ${createJerseySvg(currentColor)}
      <span class="selected-text flex-grow-1 text-start">${currentText}</span>
      <i class="bi position-absolute end-0 me-3 top-50 translate-middle-y"></i>
    `;

    // Create dropdown menu
    const ul = document.createElement('ul');
    ul.className = 'dropdown-menu w-100';

    Array.from(originalSelect.options).forEach(opt => {
      if (!opt.value) return; // skip empty options without value

      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'dropdown-item d-flex align-items-center gap-2';
      a.href = '#';
      a.innerHTML = createJerseySvg(opt.dataset.color) + opt.textContent;

      a.addEventListener('click', (e) => {
        e.preventDefault();
        // Update button appearance
        button.querySelector('svg').outerHTML = createJerseySvg(opt.dataset.color);
        button.querySelector('.selected-text').textContent = opt.textContent;
        // Keep the real <select> in sync (for form submission)
        originalSelect.value = opt.value;
      });

      li.appendChild(a);
      ul.appendChild(li);
    });

    // Wrap everything
    const wrapper = document.createElement('div');
    wrapper.className = 'dropdown';
    wrapper.appendChild(button);
    wrapper.appendChild(ul);

    // Insert the custom dropdown and hide the original <select>
    originalSelect.parentNode.insertBefore(wrapper, originalSelect);
    originalSelect.style.display = 'none';
  });
}