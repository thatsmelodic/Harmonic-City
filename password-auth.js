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
    const config=readConfig();
    const url=config.url||$('#cloudUrl')?.value.trim();
    const anonKey=config.anonKey||$('#cloudAnonKey')?.value.trim();
    const emailValue=$('#cloudEmail')?.value.trim();
    const password=input.value;
    if(!url||!anonKey){setStatus('Save the Supabase connection first.');return}
    if(!emailValue||!password){setStatus('Enter your email and password.');return}
    button.disabled=true;
    setStatus('Signing in without email…');
    try{
      const client=createClient(url,anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'harmonic-city-auth'}});
      const {data,error}=await client.auth.signInWithPassword({email:emailValue,password});
      if(error)throw error;
      if(!data.session)throw new Error('No session returned.');
      setStatus('Password sign-in successful. Loading your cloud workspace…');
      location.reload();
    }catch(error){
      setStatus(`Password sign-in failed: ${error.message}`);
      button.disabled=false;
    }
  });
}

addEventListener('DOMContentLoaded',ensurePasswordUI);
