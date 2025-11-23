// js/ui/swap.js
import './timeOut.js';
import { state } from '../state.js';
export function mainSwap(config) {
  state.isDisplaySwapped = !state.isDisplaySwapped;
  state.isTimeoutColorSwapped = state.isDisplaySwapped;
  swapColumnsGeneric(config);
  swapModal();
}

function swapColumnsGeneric(config) {
  const table = document.getElementById('scoring-table');
  const rows = table.rows;
  
  for (let i = 0; i < rows.length; i++) {
    const cell2 = rows[i].cells[1];
    const cell3 = rows[i].cells[2];
    
    const rowConfig = config[i] || config.default || [];
    
    rowConfig.forEach(rule => {
      const target2 = rule.selector ? cell2.querySelector(rule.selector) : cell2;
      const target3 = rule.selector ? cell3.querySelector(rule.selector) : cell3;
      
      if (target2 && target3) {
        if (rule.swapText) {
          const tempText = target2.textContent;
          target2.textContent = target3.textContent;
          target3.textContent = tempText;
        }
        
        if (rule.attributes && rule.attributes.length > 0) {
          rule.attributes.forEach(attr => {
            const tempAttr = target2.getAttribute(attr);
            const newValueFor2 = target3.getAttribute(attr) || '';
            const newValueFor3 = tempAttr || '';
            
            target2.setAttribute(attr, newValueFor2);
            if (newValueFor2 === '') target2.removeAttribute(attr);
            
            target3.setAttribute(attr, newValueFor3);
            if (newValueFor3 === '') target3.removeAttribute(attr);
          });
        }
        
        if (rule.properties && rule.properties.length > 0) {
          rule.properties.forEach(prop => {
            const tempProp = target2[prop];
            target2[prop] = target3[prop];
            target3[prop] = tempProp;
          });
        }
        
        // New: Support for swapping entire elements
        if (rule.swapEntireElement) {
          const clonedTarget2 = target2.cloneNode(true);
          const clonedTarget3 = target3.cloneNode(true);
          target2.parentNode.replaceChild(clonedTarget3, target2);
          target3.parentNode.replaceChild(clonedTarget2, target3);
        }
      } else {
        console.warn(`No target found for selector "${rule.selector}" in row ${i}`);
      }
    });
  }
}

export const swapConfig = {
  0: [ // Header row
    {
      selector: '',
      properties: ['id'] // Still swap cell IDs
    },
    {
      selector: 'button.team-name-button',
      swapEntireElement: true // New: Swap the whole button (moves all attrs/text)
    }
  ],
  default: [
    {
      selector: 'input.form-control',
      properties: ['id', 'value']
    }
  ]
};

function swapModal() {
  // Swap labels entirely (moves all attrs/text/IDs)
  const leftLabel = document.getElementById('scoreGameLeftLabel');
  const rightLabel = document.getElementById('scoreGameRightLabel');
  
  if (leftLabel && rightLabel) {
    const clonedLeft = leftLabel.cloneNode(true);
    const clonedRight = rightLabel.cloneNode(true);
    leftLabel.parentNode.replaceChild(clonedRight, leftLabel);
    rightLabel.parentNode.replaceChild(clonedLeft, rightLabel);
  }
  
  // Swap score displays entirely (moves text/IDs)
  const homeDisplay = document.getElementById('scoreGameHomeDisplay');
  const oppDisplay = document.getElementById('scoreGameOppDisplay');
  
  if (homeDisplay && oppDisplay) {
    const clonedHome = homeDisplay.cloneNode(true);
    const clonedOpp = oppDisplay.cloneNode(true);
    homeDisplay.parentNode.replaceChild(clonedOpp, homeDisplay);
    oppDisplay.parentNode.replaceChild(clonedHome, oppDisplay);
  }
  
  // Toggle data-team on containers, score-zones, and timeout-boxes
  const dataTeamElements = document.querySelectorAll('#scoreGameModal .timeout-container, #scoreGameModal .score-zone, #scoreGameModal .timeout-box');
  dataTeamElements.forEach(el => {
    if (el.dataset.team === 'home') {
      el.dataset.team = 'opp';
    } else if (el.dataset.team === 'opp') {
      el.dataset.team = 'home';
    }
  });
  
  // Update aria-labels by swapping team names
  const ariaElements = document.querySelectorAll('#scoreGameModal [aria-label]');
  ariaElements.forEach(el => {
    let label = el.getAttribute('aria-label');
    if (label) {
      label = label.replace(/Home Team/gi, 'TEMP_HOME');
      label = label.replace(/opponent/gi, 'TEMP_OPP');
      label = label.replace(/TEMP_HOME/gi, 'Opponent');
      label = label.replace(/TEMP_OPP/gi, 'Home Team');
      el.setAttribute('aria-label', label);
    }
  });
  // Swap timeout box states (aria-pressed and classes)
  const leftContainer = document.querySelector('.left-timeout');
  const rightContainer = document.querySelector('.right-timeout');

  if (leftContainer && rightContainer) {
    const leftBoxes = leftContainer.querySelectorAll('.timeout-box');
    const rightBoxes = rightContainer.querySelectorAll('.timeout-box');

    for (let i = 0; i < leftBoxes.length; i++) {
      const leftBox = leftBoxes[i];
      const rightBox = rightBoxes[i];

      // Swap aria-pressed
      const tempPressed = leftBox.getAttribute('aria-pressed');
      leftBox.setAttribute('aria-pressed', rightBox.getAttribute('aria-pressed'));
      rightBox.setAttribute('aria-pressed', tempPressed);

      // Swap classes (active and used)
      const leftActive = leftBox.classList.contains('active');
      const leftUsed = leftBox.classList.contains('used');
      const rightActive = rightBox.classList.contains('active');
      const rightUsed = rightBox.classList.contains('used');

      if (rightActive) {
        leftBox.classList.add('active');
      } else {
        leftBox.classList.remove('active');
      }
      if (rightUsed) {
        leftBox.classList.add('used');
      } else {
        leftBox.classList.remove('used');
      }

      if (leftActive) {
        rightBox.classList.add('active');
      } else {
        rightBox.classList.remove('active');
      }
      if (leftUsed) {
        rightBox.classList.add('used');
      } else {
        rightBox.classList.remove('used');
      }
    }
  }

  // If a timeout countdown is running, recompute its color based on the active team
  const container = document.getElementById('timeoutContainer');
  const activeBox = document.querySelector('.timeout-box.active');
  if (container && container.style.display !== 'none' && activeBox) {
    applyTimeoutTeamColor(activeBox.dataset.team, getTimeoutTeamColorMap());
  }

  // If timeout display text is visible, swap team names in it
  const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
  if (timeoutDisplay && timeoutDisplay.textContent) {
    let text = timeoutDisplay.textContent;
    text = text.replace(/Home Team/gi, 'TEMP_HOME');
    text = text.replace(/opponent/gi, 'TEMP_OPP');
    text = text.replace(/TEMP_HOME/gi, 'Opponent');
    text = text.replace(/TEMP_OPP/gi, 'Home Team');
    timeoutDisplay.textContent = text;
  }
}