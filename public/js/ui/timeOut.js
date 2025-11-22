// timeOut.js
let countdownInterval = null;
let currentActiveButton = null;

function updateDisplay(bar, label, remaining, duration) {
    const displayRemaining = Math.max(remaining, 0);
    const pct = (displayRemaining / duration) * 100;
    bar.style.width = pct + '%';
    bar.setAttribute('aria-valuenow', displayRemaining);
    const mm = Math.floor(displayRemaining / 60);
    const ss = String(displayRemaining % 60).padStart(2, '0');
    label.textContent = `${mm}:${ss}`;
}

export function resetTimeoutCountdown() {
    const container = document.getElementById("timeoutContainer");
    const bar = document.getElementById("scoreGameTimeoutSrStatus");
    const label = document.getElementById("timeoutCenteredLabel");

    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    if (bar) {
        bar.style.width = "0%";
        bar.setAttribute("aria-valuenow", 0);
    }

    if (label) {
        label.textContent = "";
    }

    if (container) {
        container.style.display = "none";
    }

    if (currentActiveButton) {
        currentActiveButton.classList.remove('active');
        currentActiveButton = null;
    }
}

export function startTimeoutCountdown(button) {
    const duration = 60;
    let remaining = duration;

    const container = document.getElementById("timeoutContainer");
    const bar = document.getElementById("scoreGameTimeoutSrStatus");
    const label = document.getElementById("timeoutCenteredLabel");

    if (!container || !bar || !label) return;

    currentActiveButton = button;

    const isLeft = button.classList.contains('team-blue');

    bar.classList.remove("bg-primary", "bg-danger");
    bar.classList.add(isLeft ? "bg-primary" : "bg-danger");

    container.style.display = "block";

    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    updateDisplay(bar, label, remaining, duration);

    countdownInterval = setInterval(() => {
        remaining--;

        updateDisplay(bar, label, remaining, duration);

        if (remaining <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            if (currentActiveButton) {
                currentActiveButton.classList.remove('active');
                currentActiveButton = null;
            }
            container.style.display = "none";
            const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
            if (timeoutDisplay) {
              timeoutDisplay.textContent = '';
            }
            return;
        }
    }, 1000);
}

function handleTimeoutClick(e) {
    const box = e.target.closest('.timeout-box');
    if (!box) return;

    const modal = document.getElementById('scoreGameModal');
    if (!modal) return;
    const setNumber = modal.dataset.currentSet;
    if (!setNumber) return;

    const team = box.dataset.team;
    const index = parseInt(box.dataset.timeoutIndex);
    const teamName = team === 'home' ? 'Home Team' : 'Opponent';
    const ord = index + 1 === 1 ? 'first' : 'second';

    const isPressed = box.getAttribute('aria-pressed') === 'true';

    const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');

    if (isPressed) {
        // Deselect
        box.setAttribute('aria-pressed', 'false');
        box.classList.remove('used', 'active');
        box.classList.add('available');
        resetTimeoutCountdown();
        box.setAttribute('aria-label', `${teamName} ${ord} timeout available`);
        if (timeoutDisplay) {
          timeoutDisplay.textContent = '';
        }
        window.setTimeouts[setNumber][team][index] = false;
    } else {
        // Select and start
        resetTimeoutCountdown(); // Cancel any existing timer
        box.setAttribute('aria-pressed', 'true');
        box.classList.remove('available');
        box.classList.add('used', 'active');
        startTimeoutCountdown(box);
        box.setAttribute('aria-label', `${teamName} ${ord} timeout used`);
        if (timeoutDisplay) {
          timeoutDisplay.textContent = `Timeout: ${teamName}`;
        }
        window.setTimeouts[setNumber][team][index] = true;
    }
}

window.addEventListener("DOMContentLoaded", () => {
    const timeoutBoxes = document.querySelectorAll('.timeout-box');
    timeoutBoxes.forEach(box => {
        box.classList.add('available');
        box.addEventListener('click', handleTimeoutClick);
    });

    document.addEventListener("click", (e) => {
        if (e.target.closest('.timeout-box') || e.target.closest('#timeoutContainer')) {
            return;
        }
        resetTimeoutCountdown();
    });
});