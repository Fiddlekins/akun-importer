import Akun from 'akun-api';
import fs from 'fs-extra';
import path from 'path';
import sanitizeHtml from 'sanitize-html';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function readInput() {
	const inputDir = path.join(__dirname, 'input');

	const filenames = await fs.readdir(inputDir);
	const fileContents = await Promise.all(filenames.filter((filename) => {
			return filename.endsWith('.txt');
		}).map((filename) => {
			return fs.readFile(path.join(inputDir, filename), 'utf8');
		})
	);
	const items = [];
	fileContents.forEach((fileContent) => {
		try {
			const json = JSON.parse(fileContent);
			items.push(json);
		} catch (err) {
			// whatever
		}
	});
	return items;
}

async function init(storyId) {
	const akunSettings = {
		hostname: 'fiction.live'
	};
	const akunQm = new Akun(akunSettings);
	const akunPlayer = new Akun(akunSettings);

	const credentials = await fs.readJson('./credentials.json');
	await akunQm.login(credentials.username, credentials.password);

	const clientQm = await akunQm.join(storyId);
	const clientPlayer = await akunPlayer.join(storyId);

	const threads = await readInput();

	await akunQm.setAnon(false);

	for (const threadData of threads) {
		console.log(`Importing ${threadData[0].sqmChapterTitle || `Thread ${threadData[0].threadNumber}`}`);

		let handledChapterStart = false;
		let qmTrip = null;

		for (const postData of threadData) {
			let res;
			if (postData.sqmType === 'qm') {
				let processedChapter = postData.comment;
				// Uncomment this to add post images. These just point back to where the images are hosted elsewhere though
				// if (postData.fileSrc) {
				// 	processedChapter = `<a href="${postData.fileSrc}"><img src="${postData.fileThumbSrc}"></a>${processedChapter}`;
				// }
				if (!handledChapterStart) {
					handledChapterStart = true;
					qmTrip = postData.trip || null;
					const title = postData.sqmChapterTitle || `Thread ${postData.threadNumber}`;
					res = await akunQm.core.post('/api/anonkun/chapter', {
						'sid': storyId,
						'nt': 'chapter',
						'b': processedChapter,
						't': title
					});

					const storyNodeData = await akunQm.getNodeData(storyId);
					const isFirst = !(storyNodeData['bm'] && storyNodeData['bm'].length);
					storyNodeData['bm'] = storyNodeData['bm'] || [];
					storyNodeData['bm'].push({
						'ct': res['ct'],
						'id': res['_id'],
						'isFirst': isFirst,
						'title': title
					});
					await akunQm.core.put('/api/node', storyNodeData);
					await clientQm.storyThread._newMetaData(storyNodeData);
					await clientPlayer.storyThread._newMetaData(storyNodeData);
					await clientQm._postPostsAChapter();
				} else {
					res = await clientQm.postChapter(processedChapter);
					if (Array.isArray(res)) {
						res = res[0];
					}
				}

				// Avoid using realtime connection because ensuring we wait for it to return the new posts makes things needlessly tricky
				// Instead manually push new post response data into the threads
				await clientQm.storyThread._newMessage(res);
				await clientPlayer.storyThread._newMessage(res);
			} else if (postData.sqmType === 'vote' || (postData.sqmType === 'player' && postData.trip === qmTrip)) {
				let processedComment = postData.comment;
				processedComment = processedComment.replace(/<br>/gi, '\n');
				processedComment = sanitizeHtml(processedComment, {
					allowedTags: [],
					allowedAttributes: {}
				});
				processedComment = processedComment.replace(/&gt;/g, '>');
				if (postData.fileSrc) {
					processedComment = `${postData.fileSrc}\n${processedComment}`;
				}

				if (postData.trip === qmTrip) {
					res = await clientQm.postChat(processedComment);
				} else {
					res = await clientPlayer.postChat(processedComment);
				}

				// Avoid using realtime connection because ensuring we wait for it to return the new posts makes things needlessly tricky
				// Instead manually push new post response data into the threads
				await clientQm.chatThread._newMessage(res);
				await clientPlayer.chatThread._newMessage(res);
			}
		}

	}
}

const storyId = 'put the id of the story you want to import to here';
init(storyId).catch(console.error);
