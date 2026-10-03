export function speakerDisplayName(spk, names) {
  return (names && names[spk]) || `说话人${spk + 1}`
}
