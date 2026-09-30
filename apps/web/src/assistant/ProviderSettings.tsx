import { useState } from 'react';
import { assistantRequest as api } from './client';
import type { Model, Provider } from './types';

const emptyModel = (): Model => ({ id: '', name: '', efforts: [], images: false, contextWindow: 32768, maxTokens: 4096 });

export default function ProviderSettings({ providers, tx, onSave }: {
  providers: Provider[]; tx(zh: string, en: string): string; onSave(): Promise<void>;
}) {
  const [id, setId] = useState(''), [name, setName] = useState(''), [url, setUrl] = useState('');
  const [protocol, setProtocol] = useState<Provider['protocol']>('openai-completions');
  const [key, setKey] = useState(''), [models, setModels] = useState<Model[]>([emptyModel()]);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  function update(index: number, patch: Partial<Model>) {
    setModels(old => old.map((model, i) => i === index ? { ...model, ...patch } : model));
  }
  async function save() {
    setSaving(true); setError('');
    try {
      if (new Set(models.map(model => model.id.trim())).size !== models.length) throw new Error(tx('模型 ID 不能重复', 'Model IDs must be unique'));
      const providerId = id || `provider-${crypto.randomUUID().slice(0, 8)}`;
      await api('/providers', { id: providerId, name, baseURL: url, protocol, models: models.map(model => ({ ...model, id: model.id.trim(), name: model.name.trim() || model.id.trim(), efforts: model.efforts.map(value => value.trim()).filter(Boolean) })), ...(key ? { apiKey: key } : {}) });
      setId(providerId); setKey(''); await onSave();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  return <form className="assistant-provider" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h3>{tx('个人 API', 'Personal API')}</h3>
    <select aria-label={tx('编辑提供方', 'Edit provider')} value={id} disabled={saving} onChange={event => {
      const provider = providers.find(item => item.id === event.target.value);
      setId(event.target.value); setName(provider?.name ?? ''); setUrl(provider?.baseURL ?? '');
      setProtocol(provider?.protocol ?? 'openai-completions'); setModels(provider?.models.map(model => ({ ...model })) ?? [emptyModel()]); setKey(''); setError('');
    }}><option value="">{tx('新增提供方', 'New provider')}</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name} {provider.credentialConfigured ? '●' : '○'}</option>)}</select>
    <label>{tx('名称', 'Name')}<input required value={name} onChange={event => setName(event.target.value)} /></label>
    <label>{tx('协议', 'Protocol')}<select value={protocol} onChange={event => setProtocol(event.target.value as Provider['protocol'])}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
    <label>Base URL<input required type="url" placeholder="https://api.example.com/v1" value={url} onChange={event => setUrl(event.target.value)} /></label>
    <label>API Key<input type="password" autoComplete="new-password" placeholder={tx('留空保留原密钥', 'Leave blank to keep existing key')} value={key} onChange={event => setKey(event.target.value)} /></label>
    {models.map((model, index) => <fieldset key={index}>
      <legend>{tx('模型', 'Model')} {index + 1}</legend>
      <label>{tx('模型 ID', 'Model ID')}<input required value={model.id} onChange={event => update(index, { id: event.target.value })} /></label>
      <label>{tx('显示名称', 'Display name')}<input value={model.name} onChange={event => update(index, { name: event.target.value })} /></label>
      <label>{tx('思考深度（逗号分隔）', 'Reasoning efforts (comma separated)')}<input value={model.efforts.join(',')} onChange={event => update(index, { efforts: event.target.value.split(',') })} placeholder="low,medium,high" onBlur={() => update(index, { efforts: model.efforts.map(value => value.trim()).filter(Boolean) })} /></label>
      <label>{tx('上下文长度', 'Context window')}<input required type="number" min={1024} max={4000000} value={model.contextWindow} onChange={event => update(index, { contextWindow: Number(event.target.value) })} /></label>
      <label>{tx('最大输出长度', 'Maximum output tokens')}<input required type="number" min={1} max={200000} value={model.maxTokens} onChange={event => update(index, { maxTokens: Number(event.target.value) })} /></label>
      <label><input type="checkbox" checked={model.images} onChange={event => update(index, { images: event.target.checked })} />{tx('支持图片', 'Supports images')}</label>
      <button type="button" disabled={models.length === 1} onClick={() => setModels(old => old.filter((_, i) => i !== index))}>{tx('移除模型', 'Remove model')}</button>
    </fieldset>)}
    <button type="button" disabled={models.length >= 100} onClick={() => setModels(old => [...old, emptyModel()])}>{tx('添加模型', 'Add model')}</button>
    <small>{tx('按提供方实际能力填写。密钥仅保存在本机 Windows 凭据保护存储中。', 'Use the provider’s actual capabilities. Keys are protected locally by Windows.')}</small>
    {error && <p role="alert">{error}</p>}<button disabled={saving}>{tx('保存提供方', 'Save provider')}</button>
  </form>;
}
