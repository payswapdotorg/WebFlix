evidence/r34a — the R34-A production acceptance pack (J40 + J42)

Lane wfx/r34a/accept-j40-j42 · base main @ 09d0205 · production targethttps://webflix-steel.vercel.app · 2026-09-28 UTC.

The composition map
artifact	what it is
ACCEPTANCE-SUMMARY.md	the J40/J42 gates adjudicated (verbatim quotes; closed vs open)
PARITY-ADJUDICATION.md	the 27 J40 pairing rows + the 13 J42 placement decisions (taxonomy-row-id-cited)
SHORTS-DEPTH-CHECK.md	the R33 follow-through on production vs the G4 corpus
YOUTUBE-COMPARISON.md	the same-content comparison rows + the environmental block record
LEDGER.md	the findings ledger (defect-candidates / environmental blocks / honest divergences / configuration divergences)
guards.md	the lane gates G1–G10 + the frozen-laws compliance + reproduction
battery-test-summary.txt	the 5256/1/0 floor proof (both runs recorded)
battery-run.log	the battery's full output (the run of record)
j40-runner/	the runner's own J40 report against production (manifest.json + summary.md + the failure artifacts) — the honest FAIL
reports/	the J40/J42 specs (verbatim from the golden-journeys doc) + J42-REPORT.md (the manual walk's manifest-shaped report)
screenshots/	every step's capture (j40-, j42-, yt-, wfx-)
snapshots/	the interactive snapshots per step
raw/j40-steps/, raw/j42-steps/	the per-step status: console / page errors / network (non-2xx/3xx itemized) / URL
raw/yt-compare/	the DOM walks (the corpus-capture pattern) for both sides
vlm/	the VLM-quoted reads of the YouTube walls
scripts/	the resumable walk drivers (j40-walk.sh, j42-walk.sh, yt-compare.sh)
_survey/	the STEP ZERO record (the repo/docs survey + the production deployment truth) + the 65 taxonomy row ids
partial-results.md	the re-entry state (the resumption law) — now the completed-phase record


```
# /home/z/my-project/RELAY-MANIFEST.txt  (storage root; manifest own sha256 089397705216ba9c93d580ddea7f3fbd3df6f03d24f7b6d8bfb43114b4bd2a77)
# R34-A RELAY MANIFEST — lane wfx/r34a/accept-j40-j42 (base main @ 09d0205, lane head d1661dd)
caef34c7b9803bdde387fc34d8f05da4d1acb0e0ece0be71c295d44477abfb28  evidence/r34a/ACCEPTANCE-SUMMARY.md
681c77cd42a3d08218cf4b71bcec3eea1f905cf37e5d03f49b65523f658c90ac  evidence/r34a/LEDGER.md
6c2437e65981776c78bd46555f5158819667dc8f2f92930f02760e6f1d6a4193  evidence/r34a/PARITY-ADJUDICATION.md
a04e783ecb46ee513a9077c73123756e641cc7c938ef112e8562a8d3d8f05a6b  evidence/r34a/README.md
b5351ad9c24c605039e482e0d3a50a699f961db6f8042c92fe7c10963b14febb  evidence/r34a/SHORTS-DEPTH-CHECK.md
1c9c8b487a823905e644a4ebe96accd2d8d1745427ffba28634da23a43f5ffde  evidence/r34a/YOUTUBE-COMPARISON.md
954661f9fe7aae4382d7be347b742a6949686690276d244d5fd66e531d4f322e  evidence/r34a/_survey/STEP-ZERO.md
9ee8c7817682461c36b19559fae17110d78b2a1571d69959b57ced1021510926  evidence/r34a/_survey/taxonomy-row-ids.txt
ee9ac74988f277ad9c638c4ea95705fd448baf104d39f0e93ac5d51ba0ab9c4c  evidence/r34a/battery-run.log
ca7a2911f239d42f93ee0efec33a416bdf3f65b28e92531e9928a1491e2843b1  evidence/r34a/battery-test-summary.txt
b8c9003f5e462427bfaf23fd10369ecb0edcc3b112edcb0c51e6323185c53bdb  evidence/r34a/guards.md
ac2b7ee24dd5c5c42e68c9f2bae9b8bda415066219549ec40a64fe1d5d2d1470  evidence/r34a/j40-runner/j40-failure.png
514a5dcd411d853e7fc19ace70d357e76ff7d73caf3c1849971ca5991500104b  evidence/r34a/j40-runner/j40-failure.snapshot.txt
d2ab382b60b4abc198e232fbd2bc265da084d3254fd2ee6363d963f7d81c6803  evidence/r34a/j40-runner/manifest.json
582c855cfa8c3b0c0e7d6e09a5c9212cc97196a6295a863882cba42294339ceb  evidence/r34a/j40-runner/summary.md
b94b3b7228f7e6314a9dd053fb26d8993ecd4329211155f916c109a8820e7d8e  evidence/r34a/partial-results.md
bc057bec06aa0b75aad18898b64017867aa6d768ed599e8e0bca74a24c3489b3  evidence/r34a/raw/j40-steps/step01-home.status.txt
ec4d481eb5b095416c6b0182426d76ff22cd9db57cd9e9ab16de5d7b75b96df5  evidence/r34a/raw/j40-steps/step02-suggestions.status.txt
05b06bcb5684cc42e809c96f5d3f64434ca21c419b087c21fd79a58fb615effd  evidence/r34a/raw/j40-steps/step03-itemhref.txt
c7ce14bdb605d51f49ad4a33d7c13b1c34c43cf0e03c324e79357918ef5a2780  evidence/r34a/raw/j40-steps/step03-itemhub.status.txt
c7ce14bdb605d51f49ad4a33d7c13b1c34c43cf0e03c324e79357918ef5a2780  evidence/r34a/raw/j40-steps/step05-controls.status.txt
5453bb18b22a41f354fb760e3ae839c5aecd1fd690ec475888c5e47bcb1e40c6  evidence/r34a/raw/j40-steps/step06-lseek.json
c7ce14bdb605d51f49ad4a33d7c13b1c34c43cf0e03c324e79357918ef5a2780  evidence/r34a/raw/j40-steps/step06-lseek.status.txt
c7ce14bdb605d51f49ad4a33d7c13b1c34c43cf0e03c324e79357918ef5a2780  evidence/r34a/raw/j40-steps/step07-upnext.status.txt
c7ce14bdb605d51f49ad4a33d7c13b1c34c43cf0e03c324e79357918ef5a2780  evidence/r34a/raw/j40-steps/step08-writes.status.txt
0dced85c223dd3f9001753fb339dca58c5cf51decd9681ff59d1fc8bdf6de69e  evidence/r34a/raw/j40-steps/step08b-queue-seam.status.txt
dd91f4e9c72458a275a103856f927d5d46b49fcaf54305459612d71b447f2d43  evidence/r34a/raw/j40-steps/step08c-itemhub-playlist.status.txt
6639253cc2dac3812f6dfb250619d5e0cef403f4569ca2e1f188fcd4e86e010f  evidence/r34a/raw/j40-steps/step09-shorts-stage.status.txt
6639253cc2dac3812f6dfb250619d5e0cef403f4569ca2e1f188fcd4e86e010f  evidence/r34a/raw/j40-steps/step09b-shorts-swipe.status.txt
2e5e7d3a8553c1ca2a52f0eacdee21a4c1816be4b86450cce124636abd7a0fa8  evidence/r34a/raw/j40-steps/step09c-shorts-unmuted.status.txt
17c5921b883e150317b9b0bb9d39c99d8a8eae54e52a5f553a9a8e5990b93d91  evidence/r34a/raw/j40-steps/step10-feedback.status.txt
50df7eb63612e2fca2a62c56045cf7bfdf7d26b880eeb6fe33498c79efaaf3c5  evidence/r34a/raw/j40-steps/step11-library.status.txt
bc057bec06aa0b75aad18898b64017867aa6d768ed599e8e0bca74a24c3489b3  evidence/r34a/raw/j42-steps/step01-anonymous.status.txt
dee73911b212563ef9f9f7ef19bd6a0fb098651568bc70dfd9870d4c904ffda2  evidence/r34a/raw/j42-steps/step02-signin.status.txt
d2b11a4916f6b54441df2c438e85c772f3409859735378d024391a1eed4b2f96  evidence/r34a/raw/j42-steps/step03-where-to-watch.status.txt
d2b11a4916f6b54441df2c438e85c772f3409859735378d024391a1eed4b2f96  evidence/r34a/raw/j42-steps/step04-peercopy.status.txt
df35235c12bbd653783c06f050976984ccc8019604f25329c40a50c6006e9723  evidence/r34a/raw/j42-steps/step05-byof.status.txt
79e947575001b42ef8b50656f6d0c8bfe01f110db265ae575bd9bc4b3c9e2895  evidence/r34a/raw/j42-steps/step06-intent-attention.status.txt
e80c927cd4497c3bd38ec8cbeada88d434890357954620e19143d203ff071a67  evidence/r34a/raw/j42-steps/step07-ai-tray.status.txt
7c3463fbeb7b1fd67b8b08cd67096ecc5e59d84437bcedfa808a356e0823de54  evidence/r34a/raw/j42-steps/step08-semantic-search.status.txt
910dd7d1a4526a86be2c811675b8409569479d09632628db6c9f2b4d38c65e6f  evidence/r34a/raw/j42-steps/step09-offline.status.txt
e604ef2bb33057d247cf1c29dda8f49b8db483d12a425779349320a4845c23b2  evidence/r34a/raw/j42-steps/step10-provenance.status.txt
61ede3c658361d144b79e48db440dad690bddb3d09d6d0a71e1075b3ea9d2eda  evidence/r34a/raw/yt-compare/wfx-ed-domwalk.json
676d87acc1a99e7c20b3ff6dacfbf941a74a89e21bc6d4507f682f1a7e3a1e08  evidence/r34a/raw/yt-compare/wfx-rick-domwalk.json
7ab96978e145f0cfb4247227abd18e5f38e186a6b1aeee6bb6e0724d0fb7d4cd  evidence/r34a/raw/yt-compare/wfx-zoo-domwalk.json
e55808e50899ae57116095016bcb392d3b1540db77df74e98e623166588d1219  evidence/r34a/raw/yt-compare/yt-ed-domwalk-settled.json
e55808e50899ae57116095016bcb392d3b1540db77df74e98e623166588d1219  evidence/r34a/raw/yt-compare/yt-ed-domwalk.json
e02745257c3187b6bba9a24d0fb99fcffe99672b5e6f5396b6ad9ca9c9037b37  evidence/r34a/raw/yt-compare/yt-rick-domwalk-settled.json
e02745257c3187b6bba9a24d0fb99fcffe99672b5e6f5396b6ad9ca9c9037b37  evidence/r34a/raw/yt-compare/yt-rick-domwalk.json
e5afb6e5bb20188376c81525e1dbb1c25e0f48f3bff13ac49644ddbea0ed9bc2  evidence/r34a/raw/yt-compare/yt-zoo-domwalk-settled.json
e5afb6e5bb20188376c81525e1dbb1c25e0f48f3bff13ac49644ddbea0ed9bc2  evidence/r34a/raw/yt-compare/yt-zoo-domwalk.json
06afb0b90cf3b54c8e7d4d5008a20ba911f89a49cbf1980010a71e0aa2b4b5a8  evidence/r34a/reports/J40-SPEC.md
a771476bdb91313c75865a43f08abde36bdbbe4f7f4092d5af32d754bbe7776f  evidence/r34a/reports/J42-REPORT.md
fb61cf841d74d205a8935e5b37ad14f3034d8c9f99a4ab595e878b4c7d4c7621  evidence/r34a/reports/J42-SPEC.md
69cafa4e323b88903412481eb9e6090ca23224e97e9288862f9062a3a622831d  evidence/r34a/screenshots/j40-step01-home.png
9bcc7e8eb5d0076227eec21dea8bdd10443537c9cc63e867799b4fd167f79420  evidence/r34a/screenshots/j40-step02-suggestions.png
35e9c814a2c8c5f735d2bfabc632b5ba57f27d679a3c026feb9682714913f550  evidence/r34a/screenshots/j40-step03-itemhub.png
b3c9946eda0beff3dd57042268ae68322a5fcd316cd9e17f3d61157e39ba8f43  evidence/r34a/screenshots/j40-step05-controls.png
56b3b011742a70731e7922a7002d9c1b36cbad2493961a86a375b73cffd87c14  evidence/r34a/screenshots/j40-step06-lseek.png
f0a6d15722170f83836c541e969b46a9854190f5dda4e482aabfb39697043512  evidence/r34a/screenshots/j40-step07-upnext.png
208f22133e0961be0cbe960f60bb1a963071a8296b4c2e5eccfcd4da92284d22  evidence/r34a/screenshots/j40-step08-writes.png
6c51357f4595a031d888b54d48138f6859b49cc6a08430f9f46e0961d8d5938e  evidence/r34a/screenshots/j40-step08b-queue-seam.png
331b3ea310ca03e4409f0f038ab70edce005e2fba470fa7e3bf8a34d1a7ee363  evidence/r34a/screenshots/j40-step08c-itemhub-playlist.png
79fcaebdf2e629d9f99432fbe9e7de7e59ae621b3177dae595ca46d895085e32  evidence/r34a/screenshots/j40-step09-shorts-stage.png
52fed38870641abb9aae7ae794ea5eba94accaca9afa98f64b2df42dbf597e21  evidence/r34a/screenshots/j40-step09b-shorts-swipe.png
a3e30a16ae548d0fa0aac792a235b5cb48f546527a0a8218f8de47f2a9c75db8  evidence/r34a/screenshots/j40-step09c-shorts-unmuted.png
4015f5240e986652e9d818293fa70d1d15cf00a1b0d31e61cbb3f9db0b241338  evidence/r34a/screenshots/j40-step10-feedback.png
6c51357f4595a031d888b54d48138f6859b49cc6a08430f9f46e0961d8d5938e  evidence/r34a/screenshots/j40-step10b-feedback-anon.png
5fe8cbc41cf31b53c704ab9d0980b2ce5320610abce8ec30938790317df169cd  evidence/r34a/screenshots/j40-step11-library.png
69cafa4e323b88903412481eb9e6090ca23224e97e9288862f9062a3a622831d  evidence/r34a/screenshots/j42-step01-anonymous.png
9e4c73942d77003da32456c657606d99260de867a745ec67560267e97a75bbf8  evidence/r34a/screenshots/j42-step02-signin.png
970363098243d976c4a5e6286365cc2f450759f2e5bc881b311536a6d42422b9  evidence/r34a/screenshots/j42-step02b-signed-in.png
970363098243d976c4a5e6286365cc2f450759f2e5bc881b311536a6d42422b9  evidence/r34a/screenshots/j42-step02c-signin-form-roundtrip.png
44068452466d49c4239144288347c0e07fb97f3e9125aa7391ef05cdd2e2ff43  evidence/r34a/screenshots/j42-step03-where-to-watch.png
44068452466d49c4239144288347c0e07fb97f3e9125aa7391ef05cdd2e2ff43  evidence/r34a/screenshots/j42-step04-peercopy.png
970363098243d976c4a5e6286365cc2f450759f2e5bc881b311536a6d42422b9  evidence/r34a/screenshots/j42-step05-byof.png
ed41f4408760c7136a0f9c1d2b500dd934604fa4a3e1b56e738da2eecdf1513d  evidence/r34a/screenshots/j42-step06-intent-attention.png
d5d4c1dbd401f47852fad1ab08e9e4629dd71758125143947320746fffad76b3  evidence/r34a/screenshots/j42-step06b-intent-set.png
5ea6253654b3a2b4c50187411dcbe2ce89793a24d555921dc9a1024d7bbb02b4  evidence/r34a/screenshots/j42-step06c-intent-persisted.png
8b9e5d3a1ba31d7aed2a6c9c222dd0fcbc86a32d486ddf0feef71b78a588897b  evidence/r34a/screenshots/j42-step07-ai-tray.png
5192fa78092a791e68a2116d03768049c216b251bdddb522da53c5b7d8ed9ca9  evidence/r34a/screenshots/j42-step08-semantic-search.png
fc939dbacfdbf67b8a29fe27f3fb44fd24c211960244bc33380627bc37d7c06a  evidence/r34a/screenshots/j42-step09-offline.png
e19d1a1f9cdd406229d45cb9204a50ef07b872d9b36071aa71594c5398d5d3f4  evidence/r34a/screenshots/j42-step10-provenance.png
4f82dbf65266ad8a113f98d68b69bdafdba37f21fb1e211e30486b5913db6ddd  evidence/r34a/screenshots/wfx-ed-item.png
39855444acfac2c173b95d1c57a25f840c343f1bd1df6144285133c055ade1b9  evidence/r34a/screenshots/wfx-rick-item.png
8f4612b374bc2fe8ae4874697d65e7ebceba0b2878f3f8d46e2ed9cf88c7b453  evidence/r34a/screenshots/wfx-zoo-item.png
933ee24e01b9c00da8017f419349c954e9524ca7938bd19c17f8b5c44d00f5e9  evidence/r34a/screenshots/yt-ed-watch-settled.png
933ee24e01b9c00da8017f419349c954e9524ca7938bd19c17f8b5c44d00f5e9  evidence/r34a/screenshots/yt-ed-watch.png
7c950d51caa3c5959d7b75e69a4813144887567e5c384cb14326d5399fafd635  evidence/r34a/screenshots/yt-rick-watch-settled.png
7c950d51caa3c5959d7b75e69a4813144887567e5c384cb14326d5399fafd635  evidence/r34a/screenshots/yt-rick-watch.png
74a10e40320600ece61ab071f60b9a393eb6bb89a3117b8323e41ed138aff8aa  evidence/r34a/screenshots/yt-zoo-after-play-click.png
74a10e40320600ece61ab071f60b9a393eb6bb89a3117b8323e41ed138aff8aa  evidence/r34a/screenshots/yt-zoo-player-area.png
2b2cc189716e1a602a9414e7d694d938283648d88633d37910cbb24a9e800b10  evidence/r34a/screenshots/yt-zoo-watch-settled.png
2b2cc189716e1a602a9414e7d694d938283648d88633d37910cbb24a9e800b10  evidence/r34a/screenshots/yt-zoo-watch.png
24d2c59f3651267d2d23b4f614b44e2787505bc5b7b3457244afe2041674bcd6  evidence/r34a/scripts/j40-walk.sh
3d5f75a9290ee144013e2ac83a013d6ff78fa88346a716782253af41aee2bba0  evidence/r34a/scripts/j42-walk.sh
20b2e8017bda9d398c47c88874b3aa4f8fa34fc3be29f83443d6861f41a5a987  evidence/r34a/scripts/yt-compare.sh
f7847e87aff23186570149f58e03c47a20572ba1b29969a5aaae247c930975d4  evidence/r34a/snapshots/j40-step01-home.snapshot.txt
77fb86bf1a3713f342e2f7c62422c1106c25bbb613c214716ffb7be31560f005  evidence/r34a/snapshots/j40-step02-suggestions.snapshot.txt
c82faa1453f7e2b2b3797f2618d83eb6e9ab4c9d73563140fbb39edbc48785bc  evidence/r34a/snapshots/j40-step03-itemhub.snapshot.txt
62358e8ed01196ff2cb462cdd1edf3574a441c2a36a7757932e6ee8dda407ea2  evidence/r34a/snapshots/j40-step05-controls.snapshot.txt
47e65333e09f9799e3e159af06a951efc894cb3cc1fa8230e8b5b1670dc102cd  evidence/r34a/snapshots/j40-step06-lseek.snapshot.txt
107a00269c73b82b877efb9b90c7386bb37ca0ee2f3a0536397392774d36b06d  evidence/r34a/snapshots/j40-step07-upnext.snapshot.txt
6356a6392f5ff4cd76c9affe6ab815e17793e2bfef78ab9946661007315ec086  evidence/r34a/snapshots/j40-step08-writes.snapshot.txt
75779c5142e1836c14a59e6b649f325f69ff727d4b2c90d60ab7187b8ac53721  evidence/r34a/snapshots/j40-step08b-queue-seam.snapshot.txt
cc833386dc96fc85915b4be386f1494e436b5509557473d4775df9ef4d777d9c  evidence/r34a/snapshots/j40-step08c-itemhub-playlist.snapshot.txt
d2911a8a71c3352ca498f35de5e0f17c270d64ef09ba156ed10ad51b43f5820c  evidence/r34a/snapshots/j40-step09-shorts-stage.snapshot.txt
cac4fb85e62e0608a21b09405db60f36eabaf1490a021c8e616a32ea7d8bbde0  evidence/r34a/snapshots/j40-step09b-shorts-swipe.snapshot.txt
8cfed25a01ed797e8e8b05c881e8e2a4a1425839c30c169aab4b9b65ee2b62d0  evidence/r34a/snapshots/j40-step09c-shorts-unmuted.snapshot.txt
7b9db45f325c6d9b714662b0c396b0f45b586e33e50d4470991697e786ff5e67  evidence/r34a/snapshots/j40-step10-feedback.snapshot.txt
fffb54339762fa4e7cedbce66de7dc3bd8e6385566ef790890985fb6f9bfa90a  evidence/r34a/snapshots/j40-step11-library.snapshot.txt
f7847e87aff23186570149f58e03c47a20572ba1b29969a5aaae247c930975d4  evidence/r34a/snapshots/j42-step01-anonymous.snapshot.txt
6c2356f0a1c9c17e1b28575f5966d973b559defcd2b6300835d6bd2331f2b5be  evidence/r34a/snapshots/j42-step02-signin.snapshot.txt
3786e89f21ed2832606a39bf6c433449df91fbe95eb46655e0c20c85b2ddae6a  evidence/r34a/snapshots/j42-step03-where-to-watch.snapshot.txt
3786e89f21ed2832606a39bf6c433449df91fbe95eb46655e0c20c85b2ddae6a  evidence/r34a/snapshots/j42-step04-peercopy.snapshot.txt
c0e4cd35dabf1f6c4d89ea4dd6a26b3413bb252f05a8c68bed0d52236d6be4de  evidence/r34a/snapshots/j42-step05-byof.snapshot.txt
1683de91db3b01906786bd3aa7ee364486cb1dca07ee109c8a595d79968d8347  evidence/r34a/snapshots/j42-step06-intent-attention.snapshot.txt
ed062f2f30a9ccc51f9f76ef7417045f9de88e366c7824317eac9b6f057e1c2b  evidence/r34a/snapshots/j42-step06b-intent-set.snapshot.txt
c18065e308eb635fd0f98bc952f906144ed916085222bb0a28db4e5c99ada120  evidence/r34a/snapshots/j42-step06c-intent-persisted.snapshot.txt
617c83a746844ea171887bf1f192a2c94e134b600e54b6f10bcaf3c20e9eb83f  evidence/r34a/snapshots/j42-step07-ai-tray.snapshot.txt
8c6fcbbfa72ae9dde8c354af3203a73b6650c9c6d8150cbbc2cde53cbcdd0a70  evidence/r34a/snapshots/j42-step08-semantic-search.snapshot.txt
aae031315c2b334cfc99645fbdd1ebb8a5d5a9f19cd07a283e78e3da4f213ac3  evidence/r34a/snapshots/j42-step09-offline.snapshot.txt
0d546e5ecc68d46bccef3ba3a946c7f676b2d60bb9c663348c802455a7cd0d08  evidence/r34a/snapshots/j42-step10-provenance.snapshot.txt
7e0bfb78770a8fad0807fea51d9fbea185e372ef27fbce9991a93235eeb9cb98  evidence/r34a/vlm/vlm-j42-step05-frame.json
61d36537f2760743f419cbbe6113269fa8871ccf1fee7cefe6beab15929ad49d  evidence/r34a/vlm/vlm-yt-rick.json
289109309c220d1ff2d219e0b37bf614ffe4a3ca55b119cec27468bd2f439718  evidence/r34a/vlm/vlm-yt-zoo-after-play.json
a93871166833c60c09f1fc6dea8c2ee34183e1fe001700611ed405542f09f623  evidence/r34a/vlm/vlm-yt-zoo.json
4b75cd66a27db8abf76e087cef2261346edaec1d55d5bb8a7d49dde615eaa210  webflix-r34a-thin.bundle
```

Recovery state: both paths delivered — the workspace re-bound via the byte-identical manifest write (sha unchanged 08939770…, re-verified 128/128 after the write), and the full composed record now rides this permanent chat as 11 blocks. The raw captures, snapshots, scripts, VLM reads, survey, specs, battery log, and bundle remain hash-recorded in the manifest block above (their bytes live in the relay + the bundle 09d0205..d1661dd, sha 4b75cd66…). Post-harvest, if you want the one-line F2/F3/F4/F9 → B2/C2/B4/B3 fix committed to PARITY-ADJUDICATION.md, say so and I'll land it as a follow-up commit + re-bundle + re-manifest.
