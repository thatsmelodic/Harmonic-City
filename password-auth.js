import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CONFIG_KEY='harmonic-city-supabase-config-v1';
const $=s=>document.querySelector(s);

function readConfig(){
  try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')}catch{return{}}
}

function setStatus(text){const el=$('#cloudStatus');if(el)el.textContent=text}

function ensurePasswordUI(){
  const email=$('#cloudEmail');
  const actions=document.querySelector('.cloud-actions');
  if(!email||!actions||$('#cloudPassword'))return;

  const label=document.createElement('label');
  label.textContent='Password';
  const input=document.createElement('input');
  input.id='cloudPassword';
  input.type='password';
  input.autocomplete='current-password';
  input.placeholder='Enter your Harmonic Cloud password';
  label.appendChild(input);
  email.closest('label')?.insertAdjacentElement('afterend',label);

  const button=document.createElement('button');
  button.id='cloudPasswordSignIn';
  button.type='button';
  button.textContent='Sign in with password';
  actions.insertBefore(button,$('#cloudSyncNow'));

  button.addEventListener('click',async()=>{
    const saved=readConfig();
    const url=$('#cloudUrl')?.value.trim()||saved.url;
    const anonKey=$('#cloudAnonKey')?.value.trim()||saved.anonKey;
    const emailValue=$('#cloudEmail')?.value.trim();
    const password=input.value;
    if(!url||!anonKey){setStatus('Cloud setup is incomplete.');return}
    if(!emailValue||!password){setStatus('Enter your email and password.');return}
    button.disabled=true;
    setStatus('Signing in…');
    try{
      // Persist the connection on this device before auth/reload. Without this,
      // mobile could sign in successfully and then lose the project config after refresh.
      localStorage.setItem(CONFIG_KEY,JSON.stringify({url,anonKey}));
      const client=createClient(url,anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'harmonic-city-auth'}});
      const {data,error}=await client.auth.signInWithPassword({email:emailValue,password});
      if(error)throw error;
      if(!data.session)throw new Error('No session returned.');
      // Verify the persisted session before reloading into cloud-sync.js.
      const {data:verified,error:verifyError}=await client.auth.getSession();
      if(verifyError)throw verifyError;
      if(!verified.session)throw new Error('The sign-in session did not persist on this device.');
      setStatus('Signed in. Opening your cloud workspace…');
      setTimeout(()=>location.reload(),300);
    }catch(error){
      setStatus(`Password sign-in failed: ${error.message}`);
      button.disabled=false;
    }
  });
}

addEventListener('DOMContentLoaded',ensurePasswordUI);