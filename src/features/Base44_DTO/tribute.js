export const TOM_TRIBUTE = Object.freeze({
  name: "Tom",
  mood: "Your first friend. Still rooting for you.",
  html: `<div class="classic-shell">
<div class="profile-columns">
<aside class="profile-left"><h1>Tom</h1>
<div class="profile-info"><div><img class="portrait" src="https://pbs.twimg.com/profile_images/1237550450/mstom_400x400.jpg" alt="Tribute profile picture"><p class="picture-caption">Profile illustration</p></div>
<div class="profile-facts"><p>":-)"</p><p>First friend<br>Forever nostalgic<br>Somewhere online<br>United States</p><p>Last Login:<br>08/27/2005-ish</p></div></div>
<section class="contact-panel"><h2>Contacting Tom</h2><ul class="contact-grid"><li><span>&#9993;</span> Send a hello</li><li><span>&#9733;</span> Friend forever</li><li><span>&#9786;</span> Already your friend</li><li><span>&#9829;</span> Favorite nostalgia</li><li><span>&#9998;</span> Write a memory</li><li><span>&#9835;</span> Share a mixtape</li><li><span>&#9728;</span> Good vibes only</li><li><span>&#9734;</span> First friend club</li></ul><p class="panel-note">Tribute decorations, not messaging controls.</p></section>
<div class="profile-url"><strong>EnQuote Space:</strong><br>Your first friend is always here.</div>
<section class="contact-panel interests"><h2>Tom's Interests</h2><dl><dt>General</dt><dd>Internet, Movies, Reading, Dancing, Karaoke, Baseball, Language, Culture, History of Communism, Philosophy, Singing/Writing Music, Running, Finding New Food, Weight Lifting, Hiking, WWI Aviation, Travel, Building Alternate Communities</dd><dt>Music</dt><dd>
<p><strong>Bands:</strong> Beatles, Superdrag, Jackson 5, Weezer, Sex Pistols, The Carpenters, Vain, Radiohead, Teenage Fanclub, Rocket from the Crypt, Pitchfork, Oasis, Rialto, Supergrass, Travis, The Doors, Cheap Trick, Simple Plan, Alice Cooper, KISS, A*TEENS, The Beach Boys, The Velvet Underground, Journey.</p>
<p><strong>Solo Artists:</strong> Billy Joel, Bruce Springsteen, Elvis, Brendan Benson, David Bowie, Rick Springfield, Barry Manilow, Paul Stanley (Solo Album), Bob Dylan, Rod Stewart.</p>
<p><strong>Singers:</strong> Michael Jackson (Age 14 &amp; Under), Karen Carpenter, Whitney Houston (particularly The Bodyguard soundtrack), George Michael, Louie Louie, Stevie Rachelle (Tuff), Davy Jones.</p>
</dd><dt>Heroes</dt><dd>People who help their teammates.</dd></dl></section>
<section class="contact-panel"><h2>Tom's Details</h2><p class="panel-note">Here for: Friends<br>Member since: 2005-ish</p></section></aside>
<main class="profile-right"><div class="extended-network">You and Tom go way back.</div>
<section class="blog"><h2>Tom's Latest Blog Notes <span>(retro archive)</span></h2><p>A fresh coat of HTML and a whole lot of memories</p><p>Eight arrows later, here we are again</p><p>My top eight: your entire team</p><p>Current playlist: the sound of a dial-up modem</p><p>New blog, same first friend energy</p><p class="archive-label">[ Greetings from the old web ]</p></section>
<section class="blurbs"><h2>Tom's Blurbs</h2><h3>About me:</h3><p>Welcome to EnQuote Space! I am the friendly face waiting at the end of your secret keyboard sequence.</p><p class="friendly-note">Make your page your own. A splash of color, a little HTML, and a wildly ambitious background are all welcome.</p><p>No need to send a friend request. You have been on my list since you arrived.</p><h3>Who I'd like to meet:</h3><p>The teammates keeping this little corner of the internet alive.</p></section>
<p class="disclaimer">I'M TOM</p></main>
</div></div>`,
  css: `*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font:13px Arial,Helvetica,sans-serif}
.classic-shell{width:100%;margin:0;background:#fff}
.classic-header{display:flex;justify-content:space-between;gap:12px;align-items:center;background:#06438c;color:#fff;padding:8px 7px;font-size:10px;letter-spacing:.3px}
.classic-header strong{white-space:nowrap}.classic-nav{background:#77a7c4;color:#fff;padding:6px;text-align:center;font-size:10px}
.profile-columns{display:grid;grid-template-columns:300px minmax(0,1fr);gap:26px;padding:16px 22px 16px 12px}
h1{font-size:18px;margin:0 0 16px}h2,h3,p{margin:0}
.profile-info{display:grid;grid-template-columns:180px minmax(0,1fr);gap:14px}.profile-facts{font-size:12px;line-height:1.15}.profile-facts p{margin:0 0 20px}
.portrait{height:145px;position:relative;overflow:hidden;background:repeating-linear-gradient(0deg,#cad4d0 0,#cad4d0 23px,#a9b9b6 24px,#a9b9b6 25px);border:1px solid #8faaa5}
.portrait-head{position:absolute;top:24px;left:calc(50% - 25px);height:60px;width:50px;border-radius:45% 45% 40% 40%;background:#d6aa87;border-top:14px solid #4c382e;transform:rotate(-12deg)}
.portrait-shirt{position:absolute;top:83px;left:calc(50% - 53px);width:106px;height:95px;border-radius:48% 48% 0 0;background:#faf4df;transform:rotate(-9deg)}
.portrait span{position:absolute;bottom:10px;right:12px;font:bold 22px Georgia;color:#23496a}
.picture-caption{text-align:center;font-size:10px;font-weight:bold;padding:10px 0 16px}
.contact-panel{border:1px solid #555;margin:0 0 22px}.contact-panel h2{font-size:12px;color:#fff;background:#73a0be;padding:3px 5px;letter-spacing:.4px}
.contact-grid{list-style:none;padding:10px;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:12px 8px;color:#143779;font-size:11px}
.contact-grid li{display:flex;align-items:center;gap:5px}.contact-grid span{font-size:16px;color:#647d37}.panel-note{padding:4px 6px;color:#666;font-size:9px}
.profile-url{border:1px solid #90a9b3;padding:3px 6px;background:#fcffff;font-size:10px}
.interests{margin-top:20px}.interests dl{display:grid;grid-template-columns:75px minmax(0,1fr);gap:3px;margin:3px;font:11px/1.1 Arial,Helvetica,sans-serif}.interests dt{background:#b1d0ef;color:#245589;font-weight:bold;padding:4px;align-self:stretch}.interests dd{background:#d5e8fb;color:#111;margin:0;padding:4px;font-weight:normal}.interests dd p+p{margin-top:10px}.interests dd strong{font-weight:bold}
.extended-network{border:2px solid #777;text-align:center;font-size:17px;font-weight:bold;padding:24px 8px;margin-bottom:15px}
.blog{font-size:12px;line-height:1.35}.blog h2{font-size:12px;letter-spacing:.4px;margin-bottom:15px}.blog h2 span{color:#17316b;font-size:11px}
.blog p{margin-bottom:15px}.archive-label{font-weight:bold;color:#143779;padding:1px 0 10px}
.blurbs h2{background:#ffcc99;color:#b57528;padding:3px 5px;font-size:12px;letter-spacing:.5px}
.blurbs h3{color:#ac6a17;font-size:13px;margin:8px 4px 0}.blurbs p{font-size:12px;line-height:1.25;margin:0 4px 10px}
.blurbs .friendly-note{color:#306326;font-weight:bold}.disclaimer{font-size:9px;color:#666;line-height:1.4;margin-top:18px}
@media(max-width:680px){.profile-columns{grid-template-columns:40% minmax(0,1fr);gap:20px;padding:14px 18px}.profile-info{grid-template-columns:58% minmax(0,1fr);gap:12px}.profile-facts{font-size:11px}}
@media(max-width:520px){.profile-columns{grid-template-columns:1fr;padding:14px;gap:20px}.classic-header{flex-wrap:wrap}.classic-header span{font-size:9px}.portrait{max-width:190px}.profile-info{grid-template-columns:190px 1fr}}
@media(max-width:340px){.profile-info{grid-template-columns:1fr}.contact-grid{grid-template-columns:1fr}}`
});
