import { mount } from 'svelte'
import './app.css'
import NativeGallery from './pages/NativeGallery.svelte'

mount(NativeGallery, { target: document.getElementById('gallery')! })
