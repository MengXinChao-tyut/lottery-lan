<template>
  <RegistrationPage v-if="view === 'join'" />
  <DrawPage v-else-if="view === 'draw'" />
  <HostDashboard v-else />
</template>
<script setup>
import RegistrationPage from './components/RegistrationPage.vue'
import HostDashboard from './components/HostDashboard.vue'
import DrawPage from './components/DrawPage.vue'
import './site.css'
const view = location.pathname.startsWith('/join') ? 'join' : location.pathname.startsWith('/display') ? 'draw' : 'host'
document.body.dataset.view = view
</script>
