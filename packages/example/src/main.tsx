import { defineApp } from 'sigx';
import { devtools } from '@sigx/devtools';
import { App } from './App';

defineApp(<App />)
    .use(devtools({ appName: 'devtools-example' }))
    .mount(document.getElementById('app')!);
