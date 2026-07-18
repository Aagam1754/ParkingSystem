export function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export function sessionTypeLabel(type) {
  switch (String(type || '').toUpperCase()) {
    case 'COMPANY':
      return 'Company pool (FCFS)';
    case 'GENERAL':
      return 'General / overflow';
    case 'GUEST':
      return 'Guest general';
    default:
      return type || '—';
  }
}

export function sessionTypeHint(type) {
  switch (String(type || '').toUpperCase()) {
    case 'COMPANY':
      return 'Allotted from your company basement pool.';
    case 'GENERAL':
      return 'Company pool was full — overflow into Basement 1 general.';
    case 'GUEST':
      return 'Unregistered plate parked in general (Basement 1).';
    default:
      return '';
  }
}
