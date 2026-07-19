async function announceReady(): Promise<void> {
  const status = document.getElementById('hidden-status');
  if (!status) {
    throw new Error('Hidden window status element was not found.');
  }

  try {
    const response = await window.pandaStageHidden.ready();
    status.textContent = response.acknowledged ? 'ready' : 'rejected';
    document.documentElement.dataset.ready = String(response.acknowledged);
  } catch (error) {
    status.textContent = 'error';
    document.documentElement.dataset.ready = 'false';
    console.error('Hidden window ready handshake failed.', error);
  }
}

void announceReady();
