import { getSupabaseClient } from './supabase-client.js';

const $ = selector => document.querySelector(selector);
function setStatus(message) { if ($('#cloudStatus')) $('#cloudStatus').textContent = message; }

function ensureAuthUi() {
  const email = $('#cloudEmail');
  const actions = document.querySelector('.cloud-actions');
  if (!email || !actions) return;

  $('#cloudSendLink')?.remove();

  let password = $('#cloudPassword');
  if (!password) {
    const label = document.createElement('label');
    label.textContent = 'Password';
    password = document.createElement('input');
    password.id = 'cloudPassword';
    password.type = 'password';
    password.autocomplete = 'current-password';
    password.placeholder = 'Enter your Harmonic Cloud password';
    label.appendChild(password);
    email.closest('label')?.insertAdjacentElement('afterend', label);
  }

  let identity = $('#cloudIdentity');
  if (!identity) {
    identity = document.createElement('p');
    identity.id = 'cloudIdentity';
    identity.className = 'cloud-status';
    identity.textContent = 'Not signed in';
    actions.before(identity);
  }

  let signIn = $('#cloudPasswordSignIn');
  if (!signIn) {
    signIn = document.createElement('button');
    signIn.id = 'cloudPasswordSignIn';
    signIn.type = 'button';
    signIn.textContent = 'Sign in';
    actions.insertBefore(signIn, $('#cloudSyncNow'));
  }

  let load = $('#cloudLoadNow');
  if (!load) {
    load = document.createElement('button');
    load.id = 'cloudLoadNow';
    load.type = 'button';
    load.textContent = 'Load Cloud Copy';
    actions.insertBefore(load, $('#cloudSignOut'));
  }

  let decision = $('#cloudDecision');
  if (!decision) {
    decision = document.createElement('div');
    decision.id = 'cloudDecision';
    decision.hidden = true;
    decision.className = 'cloud-actions';
    decision.innerHTML = '<button id="cloudUseLocal" type="button">Use this device</button><button id="cloudUseRemote" type="button">Use cloud copy</button><button id="cloudCancelDecision" type="button">Cancel</button>';
    actions.after(decision);
  }

  const signOut = $('#cloudSignOut');
  if (signOut) signOut.textContent = 'Sign out';

  signIn.addEventListener('click', async () => {
    const emailValue = email.value.trim();
    const passwordValue = password.value;
    if (!emailValue || !passwordValue) return setStatus('Enter your email and password.');
    signIn.disabled = true;
    setStatus('Signing in…');
    try {
      const { client } = await getSupabaseClient();
      const { data, error } = await client.auth.signInWithPassword({ email: emailValue, password: passwordValue });
      if (error) throw error;
      if (!data.session || !data.user) throw new Error('Supabase did not return a valid session.');
      identity.textContent = `Signed in as ${data.user.email}`;
      setStatus('Signed in. Choose which saved version to use.');
    } catch (error) {
      setStatus(`Sign in failed: ${error.message}`);
    } finally {
      signIn.disabled = false;
    }
  });

  signOut?.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      const { client } = await getSupabaseClient();
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      identity.textContent = 'Not signed in';
      setStatus('Signed out. Your current work remains on this device.');
    } catch (error) {
      setStatus(`Sign out failed: ${error.message}`);
    } finally {
      signOut.disabled = false;
    }
  });
}

addEventListener('DOMContentLoaded', ensureAuthUi);
