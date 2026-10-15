(() => {
  'use strict';
  function ask(message, initial) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('aria-label', message);
      dialog.style.cssText = 'border:1px solid #ddd7c6;border-radius:12px;padding:22px;max-width:min(460px,90vw);color:#1f2a24;background:#fffdf7;font:14px system-ui,sans-serif';
      const form = document.createElement('form');
      form.method = 'dialog';
      const label = document.createElement('label');
      label.textContent = message;
      label.style.cssText = 'display:block;margin-bottom:16px;font-size:15px';
      let input;
      if (initial !== undefined) {
        input = document.createElement('input');
        input.value = initial;
        input.required = true;
        input.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin-top:10px';
        label.append(input);
      }
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;flex-direction:row-reverse;gap:10px';
      for (const [value, text] of [['ok',initial === undefined ? 'Continue' : 'Create team'],['cancel','Cancel']]) {
        const button = document.createElement('button');
        button.type = 'submit';
        button.value = value;
        button.textContent = text;
        button.formNoValidate = value === 'cancel';
        button.className = value === 'ok' ? 'primary' : '';
        actions.append(button);
      }
      form.addEventListener('submit', event => {
        event.preventDefault();
        dialog.close(event.submitter?.value || 'ok');
      });
      dialog.addEventListener('close', () => {
        const result = dialog.returnValue === 'ok' ? (input ? input.value : true) : null;
        dialog.remove();
        resolve(result);
      }, { once:true });
      form.append(label,actions);
      dialog.append(form);
      document.body.append(dialog);
      dialog.showModal();
      if (input) { input.focus(); input.select(); }
      else actions.querySelector('[value="cancel"]').focus();
    });
  }
  window.BrowserDialog = { ask, confirm: message => ask(message) };
})();
