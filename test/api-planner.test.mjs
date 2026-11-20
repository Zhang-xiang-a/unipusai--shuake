import test from 'node:test';
import assert from 'node:assert/strict';
import {apiSettings, buildApiMessages, chatEndpoint, createApiPlanner, redactApiText} from '../src/api-planner.mjs';

const CONFIG = (overrides = {}) => ({
  api: {baseUrl: 'https://api.example.com/v1', model: 'vision-model', keyEnv: 'TEST_KEY', ...overrides},
  course: {textbook: '新视野大学英语', submitTexts: ['提交']},
  uploadScreenshots: false,
});

const ENV = {TEST_KEY: 'sk-test-key'};

const STATE = {
  taskScope: {unit: 3, path: '3-2', type: '选择题'},
  round: {number: 1, total: 1, index: 0, stalledRounds: 0, unchanged: false},
  text: '1. Choose the best answer.\nA. apple\nB. banana',
  controls: [
    {id: 'a1', tag: 'input', type: 'text', writable: true, editable: true, value: '', context: 'Q1', extra: 'drop-me'},
    {id: 'b1', tag: 'button', type: 'button', text: '提交', navigation: true},
  ],
  referenceTexts: [{path: 'Reading the text', text: 'x'.repeat(50)}],
};

// 构造可控的 fetch：从 system 里取出本轮 nonce，再回填到答案里。
// handler 返回 {status?, json}，json 即模拟的响应体。
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({url, body, authorization: options.headers.Authorization});
    const nonce = /nonce 必须为 ([0-9a-fA-F-]+)/.exec(body.messages[0].content)[1];
    const payload = handler({body, nonce, calls});
    const status = payload.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(payload.json ?? payload),
    };
  };
  return {impl, calls};
}

function planReply(nonce, actions = [{type: 'fill', id: 'a1', value: 'banana'}]) {
  return {choices: [{message: {content: JSON.stringify({nonce, task: '3-2', reason: 'fill', finished: false, evidence: '', actions})}}]};
}

// ---------- chatEndpoint ----------

test('chatEndpoint 自动补全 /chat/completions', () => {
  assert.equal(chatEndpoint('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(chatEndpoint('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(chatEndpoint('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1/chat/completions');
});

test('chatEndpoint 只放行本机 http，远程必须 https', () => {
  assert.equal(chatEndpoint('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(chatEndpoint('http://localhost:8000/v1'), 'http://localhost:8000/v1/chat/completions');
  assert.throws(() => chatEndpoint('http://api.example.com/v1'), /https/);
});

test('chatEndpoint 拒绝非法地址与携带账号密码的地址', () => {
  assert.throws(() => chatEndpoint('not a url'), /合法地址/);
  assert.throws(() => chatEndpoint('https://user:pass@api.example.com/v1'), /账号|密码/);
  assert.throws(() => chatEndpoint('https://api.example.com/v1?a=1'), /查询参数/);
});

// ---------- apiSettings ----------

test('apiSettings 缺少模型或 Key 时给出可执行提示', () => {
  assert.throws(() => apiSettings(CONFIG({model: ''}), ENV), /OPENAI_MODEL|model/);
  assert.throws(() => apiSettings(CONFIG({model: '<MODEL>'}), ENV), /OPENAI_MODEL|model/);
  assert.throws(() => apiSettings(CONFIG(), {}), /TEST_KEY/);
  assert.throws(() => apiSettings(CONFIG(), {TEST_KEY: '<KEY>'}), /TEST_KEY/);
});

test('apiSettings 解析默认值并校验取值范围', () => {
  const settings = apiSettings(CONFIG(), ENV);
  assert.equal(settings.endpoint, 'https://api.example.com/v1/chat/completions');
  assert.equal(settings.model, 'vision-model');
  assert.equal(settings.temperature, 0);
  assert.equal(settings.responseFormat, 'json_object');
  assert.equal(settings.maxReferenceChars, 6000);
  assert.throws(() => apiSettings(CONFIG({timeoutMs: 10}), ENV), /timeoutMs/);
  assert.throws(() => apiSettings(CONFIG({maxOutputTokens: 999999}), ENV), /maxOutputTokens/);
  assert.throws(() => apiSettings(CONFIG({temperature: 3}), ENV), /temperature/);
  assert.throws(() => apiSettings(CONFIG({responseFormat: 'xml'}), ENV), /responseFormat/);
  assert.throws(() => apiSettings(CONFIG({outputLimitField: 'nope'}), ENV), /outputLimitField/);
});

// ---------- redactApiText ----------

test('redactApiText 抹掉 Key 与所有 Bearer 头', () => {
  const text = redactApiText('key=sk-test-key Bearer sk-test-key', 'sk-test-key');
  assert.ok(!text.includes('sk-test-key'));
  assert.match(text, /Bearer \[REDACTED\]/);
});

// ---------- buildApiMessages ----------

test('buildApiMessages 每轮独立：system 声明无历史，user 只带本轮状态', () => {
  const settings = apiSettings(CONFIG(), ENV);
  const messages = buildApiMessages({state: STATE, nonce: 'n-1', config: CONFIG(), settings, image: 'data:image/png;base64,AAA'});
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /未提供任何历史对话/);
  assert.match(messages[0].content, /nonce 必须为 n-1/);
  assert.equal(messages[1].role, 'user');
  assert.ok(Array.isArray(messages[1].content));
  assert.equal(messages[1].content[0].type, 'text');
  assert.match(messages[1].content[0].text, /banana/);
  assert.deepEqual(messages[1].content[1], {type: 'image_url', image_url: {url: 'data:image/png;base64,AAA', detail: 'auto'}});
});

test('buildApiMessages 裁剪控件字段并按上限截断参考原文', () => {
  const settings = apiSettings(CONFIG({maxReferenceChars: 500}), ENV);
  const longState = {...STATE, referenceTexts: [{path: 'Reading the text', text: 'x'.repeat(2000)}]};
  const messages = buildApiMessages({state: longState, nonce: 'n-2', config: CONFIG(), settings, image: null});
  const userState = JSON.parse(messages[1].content[0].text.slice(messages[1].content[0].text.indexOf('{')));
  assert.equal(messages[1].content.length, 1, '纯文本模式不应带图片块');
  assert.equal(userState.controls[0].extra, undefined, '未登记字段不应发给模型');
  assert.equal(userState.controls[0].id, 'a1');
  assert.equal(userState.referenceTexts[0].text.length, 500);
});

// ---------- createApiPlanner ----------

test('createApiPlanner 请求体使用 OpenAI 兼容格式并返回校验后的计划', async () => {
  const {impl, calls} = fakeFetch(({nonce}) => ({json: planReply(nonce)}));
  const plan = createApiPlanner({config: CONFIG(), env: ENV, fetchImpl: impl, announce: () => {}});
  const result = await plan(STATE, null);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].type, 'fill');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(calls[0].authorization, 'Bearer sk-test-key');
  assert.equal(calls[0].body.model, 'vision-model');
  assert.equal(calls[0].body.temperature, 0);
  assert.deepEqual(calls[0].body.response_format, {type: 'json_object'});
  assert.equal(calls[0].body.stream, false);
  assert.equal(calls[0].body.max_tokens, 8192);
});

test('createApiPlanner nonce 不匹配时自动重试一次并成功', async () => {
  const retrying = fakeFetch(({nonce, calls}) => ({json: calls.length === 1 ? planReply('wrong-nonce') : planReply(nonce)}));
  const plan = createApiPlanner({config: CONFIG(), env: ENV, fetchImpl: retrying.impl, announce: () => {}});
  const result = await plan(STATE, null);
  assert.equal(result.actions.length, 1);
  assert.equal(retrying.calls.length, 2, '第一次 nonce 不匹配后应重试');
});

test('createApiPlanner 遇到 401 直接抛致命错误，不重试', async () => {
  const {impl, calls} = fakeFetch(() => ({status: 401, json: {error: {message: 'invalid api key'}}}));
  const plan = createApiPlanner({config: CONFIG(), env: ENV, fetchImpl: impl, announce: () => {}});
  await assert.rejects(() => plan(STATE, null), /401/);
  assert.equal(calls.length, 1);
});

test('createApiPlanner 输出被截断时重试后仍失败并保留原因', async () => {
  const {impl, calls} = fakeFetch(() => ({json: {choices: [{finish_reason: 'length', message: {content: '{"nonce":"x"'}}]}}));
  const plan = createApiPlanner({config: CONFIG(), env: ENV, fetchImpl: impl, announce: () => {}});
  await assert.rejects(() => plan(STATE, null), /重试后仍失败/);
  assert.equal(calls.length, 2);
});

test('createApiPlanner 服务不支持 json_object 时自动降级为普通输出', async () => {
  let seen = 0;
  const impl = async (url, options) => {
    const body = JSON.parse(options.body);
    seen++;
    if (body.response_format) {
      return {ok: false, status: 400, text: async () => JSON.stringify({error: {message: 'response_format is not supported'}})};
    }
    const nonce = /nonce 必须为 ([0-9a-fA-F-]+)/.exec(body.messages[0].content)[1];
    return {ok: true, status: 200, text: async () => JSON.stringify(planReply(nonce))};
  };
  const plan = createApiPlanner({config: CONFIG(), env: ENV, fetchImpl: impl, announce: () => {}});
  const result = await plan(STATE, null);
  assert.equal(result.actions.length, 1);
  assert.equal(seen, 2);
});