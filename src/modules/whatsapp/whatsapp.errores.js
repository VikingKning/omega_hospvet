// Solo campos de diagnostico; nunca incluir headers, tokens ni el payload.
function diagnosticoMeta(res, data) {
  const error = data.error;
  return {
    codigo: error?.code ?? null,
    subcodigo: error?.error_subcode ?? null,
    httpStatus: res.status ?? null,
    referenciaMeta: error?.fbtrace_id ?? null,
    detalle: error?.error_data?.details ?? error?.message ?? null,
  };
}

module.exports = { diagnosticoMeta };
