(() => {
  const form = document.querySelector('#waitlist form');
  if (!form || !window.fetch) return;

  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[role="status"]');
  const originalLabel = button.textContent;
  const german = document.documentElement.lang === 'de';
  const messages = german ? {
    pending: 'Anmeldung wird gesendet …',
    success: 'Bitte prüfen Sie Ihren Posteingang. Wenn diese Adresse für eine neue Anmeldung infrage kommt, wurde eine Bestätigungs-E-Mail eingeplant. Die Zustellung kann einen Moment dauern. Prüfen Sie auch Ihren Spamordner. Bereits bestätigte Adressen müssen sich nicht erneut anmelden; eine neue Bestätigungs-E-Mail kann einmal pro Stunde angefordert werden.',
    invalid: 'Bitte prüfen Sie Ihre Angaben und stimmen Sie den E-Mail-Updates zu.',
    limited: 'Zu viele Anfragen. Bitte versuchen Sie es in einer Stunde erneut.',
    unavailable: 'Die Warteliste ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in einigen Minuten erneut.',
    network: 'Die Anfrage konnte nicht abgeschlossen werden. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    done: 'Bitte E-Mail bestätigen',
  } : {
    pending: 'Submitting your signup …',
    success: 'Check your inbox. If this address is eligible for a new signup, a confirmation email has been queued. It may take a moment to arrive; check your spam folder too. Existing subscribers do not need to sign up again; confirmation emails can be requested once per hour.',
    invalid: 'Please check your details and agree to the email updates.',
    limited: 'Too many requests. Please try again in an hour.',
    unavailable: 'The waitlist is temporarily unavailable. Please try again in a few minutes.',
    network: 'Your request could not be completed. Please check your connection and try again.',
    done: 'Check your inbox',
  };
  let busy = false;
  let submitted = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || submitted) return;
    const body = new URLSearchParams(new FormData(form));
    busy = true;
    button.disabled = true;
    button.textContent = messages.pending;
    form.setAttribute('aria-busy', 'true');
    status.textContent = messages.pending;

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body,
      });
      const result = await response.json();
      if (!response.ok) {
        status.textContent = german
          ? (response.status === 429 ? messages.limited : response.status < 500 ? messages.invalid : messages.unavailable)
          : result.message || messages.unavailable;
        return;
      }
      submitted = true;
      status.textContent = messages.success;
      button.textContent = messages.done;
    } catch {
      status.textContent = messages.network;
    } finally {
      busy = false;
      form.removeAttribute('aria-busy');
      if (!submitted) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  });
})();
