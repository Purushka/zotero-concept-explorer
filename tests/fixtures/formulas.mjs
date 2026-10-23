export const infoNCE=String.raw`\mathcal{L}_{\mathrm{tcn}}=-\sum_{b=1}^{B}\log\frac{e^{S(z_i^b,z_j^b)}}{e^{S(z_i^b,z_j^b)}+e^{S(z_i^b,z_k^b)}+e^{S(z_i^b,z_i^{b'\ne b})}}`;
export const formulaText='InfoNCE 时间对比损失：\n\n$$'+infoNCE+'$$\n\n其中 $z=F_{\\phi}(I)$，$i<j<k$，$S(u,v)=-\\lVert u-v\\rVert_2$。';
