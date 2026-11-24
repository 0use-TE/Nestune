import { catalogId, catalogSong } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { body, fail, numericId, str } from '@/server/http';
import { notifyListeningUsers } from '@/server/listening-events';
import { addDomainSong, answerDomainInvite, createDomain, domainAudience, inviteDomainMember, leaveDomain, listDomains, readDomain, readDomainMessages, removeDomainSong, requireDomain, sendDomainMessage } from '@/server/listening-domains';

const options = { bucket: 'domains' };

function id(value: unknown) {
  const valueId = Number(numericId(value));
  if (!Number.isSafeInteger(valueId) || valueId < 1) throw fail(400, 'ID 无效');
  return valueId;
}

export const GET = userRoute((req, _ctx, user) => {
  const domain = req.nextUrl.searchParams.get('id');
  const before = req.nextUrl.searchParams.get('before');
  if (domain === null) return { domains: listDomains(user.id) };
  if (before !== null) return readDomainMessages(id(domain), user.id, id(before));
  return { domain: readDomain(id(domain), user.id) };
}, options);

export const POST = userRoute(async (req, _ctx, user, sessionId) => {
  const value = await body<Record<string, unknown>>(req, 4096);
  if (!value || typeof value !== 'object') throw fail(400, '请求无效');
  if (value.action === 'create') return { id: createDomain(user.id, str(value.name, 1, 32, '域名称')) };
  const domain = id(value.domainId);
  let added: boolean | undefined;
  switch (value.action) {
    case 'invite': inviteDomainMember(domain, user.id, id(value.peerId)); break;
    case 'accept': case 'decline': answerDomainInvite(domain, user.id, value.action === 'accept'); break;
    case 'leave': leaveDomain({ userId: user.id, sessionId }, domain); break;
    case 'message': sendDomainMessage(domain, user.id, str(value.text, 1, 1000, '消息')); break;
    case 'share': case 'add': {
      requireDomain(domain, user.id);
      const song = await catalogSong(user.id, catalogId(value.songId));
      if (value.action === 'share') sendDomainMessage(domain, user.id, '分享歌曲', song);
      else added = addDomainSong(domain, user.id, song);
      break;
    }
    case 'remove': removeDomainSong(domain, user.id, catalogId(value.songId)); break;
    default: throw fail(400, '未知操作');
  }
  notifyListeningUsers(domainAudience(domain).filter(id => id !== user.id));
  return { ok: true, added };
}, options);
